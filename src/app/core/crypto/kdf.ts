import { Bytes, toBase64Url, utf8 } from './base64url';

/**
 * Turning a typed password into the two things it has to become.
 *
 * THE SPLIT, AND WHY IT IS NOT OPTIONAL
 *
 * If the browser sent the password and also derived the encryption key from it, then for the one
 * moment of signing in the server would hold everything it needs to open the account - and "the key
 * never leaves the browser" would be a statement about storage rather than about the system. A
 * server that wanted to read a user's preparation would not have to break anything; it would only
 * have to keep what it was already being handed.
 *
 * So the password is stretched once, expensively, into a master secret that stays here, and that
 * secret is expanded into two independent keys:
 *
 *     authSecret   sent instead of the password, and BCrypted on the other side
 *     vaultKey     wraps the account's master key, and is never sent, stored or logged
 *
 * HKDF's expansion is one-way and domain-separated, so possessing authSecret says nothing about
 * vaultKey. The server therefore never holds a value that could be turned into the key, at rest or
 * in flight, and the guarantee stops depending on the server's good behaviour.
 *
 * THE SALT IS THE EMAIL ADDRESS
 *
 * A KDF salt has to be unique per account and known to whoever is deriving; it does not have to be
 * secret and it does not have to be random. The address is both, and using it means /prelogin can
 * answer an unknown address exactly as it answers a known one - there is no stored salt to have or
 * not have, so the endpoint cannot be turned into a way of asking who has an account here.
 *
 * WHY PBKDF2 AND NOT ARGON2
 *
 * Argon2id is the better function and it is where this should end up. PBKDF2-SHA256 is here because
 * WebCrypto implements it natively: no WebAssembly module in the path of signing in, nothing to
 * fetch before a password can be typed, and no second implementation to keep in step. The KDF is
 * described by a name and its parameters, stored per account, so moving to Argon2id later is a new
 * name for new accounts and a re-wrap for existing ones - not a flag day.
 */

export interface KdfParameters {
	readonly name: 'PBKDF2-SHA256';
	readonly iterations: number;
}

/**
 * OWASP's current figure for PBKDF2-HMAC-SHA256. It costs about a second on a mid-range laptop,
 * which is paid once per sign-in and is the whole of what stands between a stolen database of wraps
 * and someone's preparation.
 */
export const DEFAULT_KDF: KdfParameters = { name: 'PBKDF2-SHA256', iterations: 600_000 };

/** The KDF descriptor as the server stores it: parsed leniently, refused when it is not understood. */
export function parseKdf(descriptor: string): KdfParameters {
	let parsed: unknown;
	try {
		parsed = JSON.parse(descriptor);
	} catch {
		throw new Error('This account records an encryption setting this version cannot read');
	}

	const record = parsed as Partial<KdfParameters>;
	if (record?.name !== 'PBKDF2-SHA256' || typeof record.iterations !== 'number') {
		throw new Error('This account records an encryption setting this version cannot read');
	}

	/**
	 * A floor, not a ceiling. The figure arrives from the server, and a server that could talk a
	 * browser into deriving with one iteration would have talked it into handing over the password.
	 * The upper bound is only there so that a corrupt value cannot hang the tab for an hour.
	 */
	const iterations = Math.min(Math.max(record.iterations, 100_000), 5_000_000);
	return { name: 'PBKDF2-SHA256', iterations };
}

export function describeKdf(kdf: KdfParameters): string {
	return JSON.stringify({ name: kdf.name, iterations: kdf.iterations });
}

/** What one password stretches into. Held for the length of a sign-in and then let go. */
export interface DerivedSecrets {
	/** base64url. Sent to /api/auth in place of the password. */
	readonly authSecret: string;
	/** AES-GCM, non-extractable. Wraps the account's master key; never leaves this module's callers. */
	readonly vaultKey: CryptoKey;
}

export async function deriveFromPassword(
	password: string,
	email: string,
	kdf: KdfParameters,
): Promise<DerivedSecrets> {
	const stretched = await stretch(password, await saltFor('kdf', email), kdf);

	const [authSecret, vaultKey] = await Promise.all([
		expandToSecret(stretched, 'pmp/auth/v1'),
		expandToKey(stretched, 'pmp/vault/v1'),
	]);

	return { authSecret, vaultKey };
}

/**
 * The recovery code's key. A separate stretch with its own salt rather than another branch off the
 * password's: the two must stay independent, because the whole point of the recovery code is that it
 * works when the password is the thing that was lost.
 */
export async function deriveFromRecoveryCode(
	recoveryCode: string,
	email: string,
	kdf: KdfParameters,
): Promise<CryptoKey> {
	const stretched = await stretch(normaliseCode(recoveryCode), await saltFor('recovery', email), kdf);
	return expandToKey(stretched, 'pmp/recovery/v1');
}

/**
 * PBKDF2 over the password, into 32 bytes that never go anywhere.
 *
 * Extractable on purpose: HKDF needs the raw bytes to expand from, and this value exists for a few
 * milliseconds inside one function. What the callers get back is not extractable.
 */
async function stretch(secret: string, salt: Bytes, kdf: KdfParameters): Promise<Bytes> {
	const material = await crypto.subtle.importKey('raw', utf8(secret), 'PBKDF2', false, [
		'deriveBits',
	]);

	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt, iterations: kdf.iterations, hash: 'SHA-256' },
		material,
		256,
	);
	return new Uint8Array(bits);
}

async function expandToSecret(stretched: Bytes, info: string): Promise<string> {
	return toBase64Url(new Uint8Array(await expand(stretched, info)));
}

async function expandToKey(stretched: Bytes, info: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		await expand(stretched, info),
		{ name: 'AES-GCM', length: 256 },
		/** Not extractable: nothing in this application has a reason to read this key's bytes. */
		false,
		['encrypt', 'decrypt'],
	);
}

/**
 * HKDF-Expand with an empty salt. The input is already a uniformly random 256-bit value out of
 * PBKDF2, so the extract step has nothing left to do; `info` is what separates the two outputs, and
 * it is a constant string rather than anything caller-supplied so that the separation cannot be
 * argued away by a caller.
 */
async function expand(stretched: Bytes, info: string): Promise<ArrayBuffer> {
	const material = await crypto.subtle.importKey('raw', stretched, 'HKDF', false, ['deriveBits']);

	return crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) },
		material,
		256,
	);
}

/**
 * The salt for one purpose and one account. Hashed rather than used raw so that it is a fixed 32
 * bytes whatever the address looks like, and prefixed so that the password's salt and the recovery
 * code's salt are different values for the same person.
 */
async function saltFor(purpose: 'kdf' | 'recovery', email: string): Promise<Bytes> {
	const digest = await crypto.subtle.digest('SHA-256', utf8(`pmp/${purpose}/v1|${email.trim().toLowerCase()}`));
	return new Uint8Array(digest);
}

/** Whitespace and case are what a person retyping a recovery code gets wrong; neither is meaningful. */
function normaliseCode(code: string): string {
	return code.replace(/[\s-]/g, '').toUpperCase();
}
