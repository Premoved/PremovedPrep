import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { fromBase64Url, randomBytes, toBase64Url } from './base64url';
import { EnvelopePurpose, open, seal } from './envelope';
import { DEFAULT_KDF, KdfParameters, describeKdf, deriveFromPassword, deriveFromRecoveryCode, parseKdf } from './kdf';
import { newRecoveryCode, readRecoveryCode } from './recovery-code';
import { NewVault, Prelogin, RecoverableVault, VaultMaterial, VaultView } from './vault.model';
import { forgetKey, recallKey, rememberKey } from './vault-storage';

/**
 * The account's master key, and everything that is done with it.
 *
 * THE SHAPE OF THE THING
 *
 * There is one master key per account. It is random, it is never derived from anything, and it is
 * what every stored document is sealed under. The password does not encrypt documents; it derives a
 * key that encrypts the master key. That indirection is what makes changing a password a single
 * small write instead of re-uploading a library, and it is what lets a recovery code open the same
 * account without being a second password.
 *
 *     password ──PBKDF2+HKDF──▶ vaultKey ──wraps──▶ masterKey ──seals──▶ every PGN
 *     recovery ──PBKDF2+HKDF──▶ recoveryKey ──wraps──▶ (the same masterKey)
 *
 * WHAT `locked` MEANS
 *
 * Signed in and locked is a real state, and the rest of the application has to be able to see it.
 * It happens when a session is restored from the refresh cookie in a browser that has no key: a new
 * device, a cleared profile, a private window. The account is reachable, the collections list will
 * load, and not one entry in it can be read until the password is typed. Pretending otherwise -
 * showing empty folders, or an error per row - is how that state gets shipped by accident.
 */
@Injectable({ providedIn: 'root' })
export class VaultService {
	private readonly http = inject(HttpClient);
	private readonly baseUrl = `${environment.apiBaseUrl}`;

	private readonly _keyId = signal<string | null>(null);
	private masterKey: CryptoKey | null = null;

	/**
	 * A recovery code waiting to be put in front of the person, and the only copy of it anywhere.
	 *
	 * It sits here rather than being passed along a navigation because it has to survive whatever the
	 * person does next, and because exactly one thing may clear it: them saying they have kept it.
	 */
	private readonly _pendingRecoveryCode = signal<string | null>(null);

	readonly pendingRecoveryCode = this._pendingRecoveryCode.asReadonly();

	/** Whether this browser can currently read this account's work. */
	readonly unlocked = computed(() => this._keyId() !== null);

	readonly keyId = this._keyId.asReadonly();

	// -----------------------------------------------------------------
	// Sealing and opening. The only two methods the rest of the
	// application calls in the normal course of things.
	// -----------------------------------------------------------------

	async seal(purpose: EnvelopePurpose, plaintext: string): Promise<string> {
		const { key, keyId } = this.require();
		return seal(key, keyId, purpose, plaintext);
	}

	async open(purpose: EnvelopePurpose, envelope: string): Promise<string> {
		const { key, keyId } = this.require();
		return open(key, keyId, purpose, envelope);
	}

	/**
	 * Refused rather than queued. A caller reaching here while the vault is locked is a bug in the
	 * caller - it drew a screen that needs decryption without checking whether it could decrypt - and
	 * blocking on an unlock that may never come would turn that bug into a hang.
	 */
	private require(): { key: CryptoKey; keyId: string } {
		const keyId = this._keyId();
		if (this.masterKey === null || keyId === null) {
			throw new VaultLockedError();
		}
		return { key: this.masterKey, keyId };
	}

	// -----------------------------------------------------------------
	// Creating, opening and re-wrapping the vault itself.
	// -----------------------------------------------------------------

	prelogin(email: string): Promise<Prelogin> {
		return firstValueFrom(
			this.http.get<Prelogin>(`${this.baseUrl}/auth/prelogin`, { params: { email }, withCredentials: true }),
		);
	}

	/**
	 * A brand new vault: a fresh master key, a fresh recovery code, and the two wraps around it.
	 *
	 * Nothing is unlocked here and nothing is stored. The caller registers the account with what comes
	 * back and then signs in like anyone else, which means the very first sign-in exercises the same
	 * path every later one does, rather than a shortcut that only runs once and is therefore only
	 * broken once.
	 */
	async create(password: string, email: string, kdf: KdfParameters = DEFAULT_KDF): Promise<NewVault> {
		const keyId = toBase64Url(randomBytes(16));
		const recoveryCode = newRecoveryCode();

		const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
			'encrypt',
			'decrypt',
		]);
		const rawMaster = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));

		const [derived, recoveryKey] = await Promise.all([
			deriveFromPassword(password, email, kdf),
			deriveFromRecoveryCode(readRecoveryCode(recoveryCode) ?? recoveryCode, email, kdf),
		]);

		const [passwordWrap, recoveryWrap] = await Promise.all([
			seal(derived.vaultKey, keyId, 'wrap:password', toBase64Url(rawMaster)),
			seal(recoveryKey, keyId, 'wrap:recovery', toBase64Url(rawMaster)),
		]);

		rawMaster.fill(0);

		return {
			material: { keyId, kdf: describeKdf(kdf), passwordWrap, recoveryWrap },
			authSecret: derived.authSecret,
			recoveryCode,
		};
	}

	/**
	 * The normal unlock: the password that was just typed, and the wraps this account stores.
	 *
	 * Returns the authentication half as well, because the caller is signing in and needs both from
	 * one derivation - deriving twice would double the second that PBKDF2 costs for no reason.
	 */
	async unlockWithPassword(password: string, email: string, vault: VaultView, userId: number): Promise<string> {
		const derived = await deriveFromPassword(password, email, parseKdf(vault.kdf));
		await this.unlockWithDerived(derived.vaultKey, vault, userId);
		return derived.authSecret;
	}

	/**
	 * The same unlock, given a key the caller has already derived.
	 *
	 * Signing in needs both halves of one derivation - the secret to send and the key to open with -
	 * and PBKDF2 costs about a second, so deriving twice to keep the two calls tidy would be a second
	 * of the person's time spent on tidiness.
	 */
	async unlockWithDerived(vaultKey: CryptoKey, vault: VaultView, userId: number | null): Promise<void> {
		const master = await this.unwrap(vaultKey, vault.keyId, 'wrap:password', vault.passwordWrap);
		await this.adoptMaster(vault.keyId, master, userId);
	}

	/**
	 * The other way in, for someone who has lost the password and kept the code.
	 *
	 * `userId` may be null, and is on the reset screen: there is no session there, so there is nobody
	 * to remember the key for. It is unlocked for the length of the re-wrap and then let go.
	 */
	async unlockWithRecoveryCode(
		code: string,
		email: string,
		vault: RecoverableVault,
		userId: number | null,
	): Promise<void> {
		const normalised = readRecoveryCode(code);
		if (normalised === null) {
			throw new Error('That is not a recovery code for this application');
		}

		const recoveryKey = await deriveFromRecoveryCode(normalised, email, parseKdf(vault.kdf));
		const master = await this.unwrap(recoveryKey, vault.keyId, 'wrap:recovery', vault.recoveryWrap);
		await this.adoptMaster(vault.keyId, master, userId);
	}

	/**
	 * Whether this recovery code is the account's, answered before anything irreversible happens.
	 *
	 * The answer is certain, not a guess. The code derives a key, the key either opens the recovery
	 * wrap or fails GCM's authentication tag, and there is no third outcome - a wrong code cannot
	 * accidentally produce a plausible master key. So the reset screen can refuse a mistyped code
	 * instead of spending the link and deleting a library over a transposed character.
	 *
	 * It costs one PBKDF2, about a second, which is the same second the reset itself would have cost.
	 */
	async verifyRecoveryCode(code: string, email: string, vault: RecoverableVault): Promise<boolean> {
		const normalised = readRecoveryCode(code);
		if (normalised === null) {
			return false;
		}

		try {
			const recoveryKey = await deriveFromRecoveryCode(normalised, email, parseKdf(vault.kdf));
			await open(recoveryKey, vault.keyId, 'wrap:recovery', vault.recoveryWrap);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Key material for an account that has just adopted encryption, with the master key already in
	 * hand: the browser made it a moment ago and is about to start sealing this account's entries
	 * with it, so it is unlocked here rather than being re-derived from what was just written.
	 */
	async adoptCreated(created: NewVault, vaultKey: CryptoKey, userId: number): Promise<void> {
		await this.unlockWithDerived(vaultKey, { ...created.material, createdAt: null, updatedAt: null }, userId);
	}

	/**
	 * What a reload does: the session came back from the cookie, so look for the key this browser was
	 * holding. False means signed in and locked, which is a state the application draws rather than
	 * an error it reports.
	 */
	async restore(userId: number, vault: VaultView): Promise<boolean> {
		const key = await recallKey(userId, vault.keyId);
		if (key === null) {
			return false;
		}
		this.masterKey = key;
		this._keyId.set(vault.keyId);
		return true;
	}

	/**
	 * Re-seals the same master key under a new password, keeping the recovery code as it was.
	 *
	 * The master key does not change, so nothing that is stored is touched. The one thing the caller
	 * must not do is treat this as optional: a password changed without it is a password that no
	 * longer opens the vault, and there is nobody who could repair that afterwards.
	 */
	async rewrapForNewPassword(
		newPassword: string,
		email: string,
		vault: RecoverableVault,
	): Promise<{ material: VaultMaterial; authSecret: string }> {
		const { key, keyId } = this.require();
		const kdf = parseKdf(vault.kdf);

		const rawMaster = new Uint8Array(await this.exportMaster(key));
		const derived = await deriveFromPassword(newPassword, email, kdf);
		const passwordWrap = await seal(derived.vaultKey, keyId, 'wrap:password', toBase64Url(rawMaster));
		rawMaster.fill(0);

		return {
			material: { keyId, kdf: vault.kdf, passwordWrap, recoveryWrap: vault.recoveryWrap },
			authSecret: derived.authSecret,
		};
	}

	/**
	 * A new recovery code for an account whose password is still known.
	 *
	 * The master key and its keyId are untouched - only the second wrapping around the same key is
	 * replaced - so nothing stored is rewritten and the account's entries keep opening. What changes
	 * is that the previous code stops working, which is the point of asking for a new one.
	 */
	async replaceRecoveryCode(password: string, email: string, known?: VaultView): Promise<string> {
		const stored = known ?? (await this.vault());
		const { key, keyId } = this.require();
		const kdf = parseKdf(stored.kdf);

		const recoveryCode = newRecoveryCode();
		const recoveryKey = await deriveFromRecoveryCode(readRecoveryCode(recoveryCode) ?? recoveryCode, email, kdf);

		const rawMaster = new Uint8Array(await this.exportMaster(key));
		const recoveryWrap = await seal(recoveryKey, keyId, 'wrap:recovery', toBase64Url(rawMaster));
		rawMaster.fill(0);

		/** The password half is sent back exactly as it was: the server refuses a call that alters it. */
		const derived = await deriveFromPassword(password, email, kdf);

		await firstValueFrom(
			this.http.post<VaultView>(`${this.baseUrl}/vault/recovery-code`, {
				currentSecret: derived.authSecret,
				vault: { keyId, kdf: stored.kdf, passwordWrap: stored.passwordWrap, recoveryWrap },
			}),
		);

		this._pendingRecoveryCode.set(recoveryCode);
		return recoveryCode;
	}

	/**
	 * The first sign-in's code.
	 *
	 * An account registers with a recovery code nobody is shown: registering and first signing in are
	 * two visits, and the code exists only in the tab that made it. Keeping it in between would mean
	 * storing it. So the first sign-in - the first moment the password and an unlocked vault are in
	 * the same place again - quietly replaces it with one that will be shown.
	 */
	async ensureRecoveryCode(password: string, email: string): Promise<void> {
		const stored = await this.vault();
		if (stored.acknowledgedAt !== null) {
			return;
		}
		await this.replaceRecoveryCode(password, email, stored);
	}

	/** The person says they have kept it. The only thing that clears the pending code. */
	async acknowledgeRecoveryCode(): Promise<void> {
		await firstValueFrom(this.http.post<void>(`${this.baseUrl}/vault/recovery-code/acknowledge`, {}));
		this._pendingRecoveryCode.set(null);
	}

	/**
	 * Re-seals the master key this browser is already holding under a new password, without needing
	 * the recovery code.
	 *
	 * This is what makes a reset survivable for someone who is still signed in somewhere: the key is
	 * in this browser, so the new password can be wrapped around it directly. `expectedKeyId` is the
	 * guard - the vault unlocked here must be the one the reset link is for, or a second account
	 * signed in on this machine would have its key written into somebody else's reset.
	 */
	async rewrapFromUnlocked(
		newPassword: string,
		email: string,
		vault: RecoverableVault,
	): Promise<{ material: VaultMaterial; authSecret: string } | null> {
		if (!this.unlocked() || this._keyId() !== vault.keyId) {
			return null;
		}
		return this.rewrapForNewPassword(newPassword, email, vault);
	}

	/** This account's stored material. */
	vault(): Promise<VaultView> {
		return firstValueFrom(this.http.get<VaultView>(`${this.baseUrl}/vault`));
	}

	/** Signing out: the key goes, here and in the browser's store. */
	async lock(): Promise<void> {
		this.masterKey = null;
		this._keyId.set(null);
		this._pendingRecoveryCode.set(null);
		await forgetKey();
	}

	// -----------------------------------------------------------------

	private async unwrap(
		wrappingKey: CryptoKey,
		keyId: string,
		purpose: EnvelopePurpose,
		wrap: string,
	): Promise<Uint8Array> {
		return fromBase64Url(await open(wrappingKey, keyId, purpose, wrap));
	}

	/**
	 * Imports the unwrapped bytes as a key this browser will hold, and zeroes the copy it came in.
	 *
	 * Extractable, and deliberately so: rewrapForNewPassword has to be able to seal these same bytes
	 * under a new password, and a non-extractable key could not be re-wrapped without asking the
	 * person to re-upload everything they own. It is the one extractable key in the application, it
	 * never leaves this service, and what protects it is that it is reachable only from code running
	 * on this origin - the same thing that protects a non-extractable key from being used.
	 */
	private async adoptMaster(keyId: string, rawMaster: Uint8Array, userId: number | null): Promise<void> {
		const key = await crypto.subtle.importKey('raw', rawMaster, { name: 'AES-GCM', length: 256 }, true, [
			'encrypt',
			'decrypt',
		]);
		rawMaster.fill(0);

		this.masterKey = key;
		this._keyId.set(keyId);

		/** Null is the reset screen, where there is no session for a remembered key to belong to. */
		if (userId !== null) {
			await rememberKey({ userId, keyId, key });
		}
	}

	private exportMaster(key: CryptoKey): Promise<ArrayBuffer> {
		return crypto.subtle.exportKey('raw', key);
	}
}

/** Thrown when something asks to read or write an account's work while the vault is locked. */
export class VaultLockedError extends Error {
	constructor() {
		super('This browser cannot read your files until you enter your password');
		this.name = 'VaultLockedError';
	}
}
