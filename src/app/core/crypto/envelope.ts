import { Bytes, fromBase64Url, fromUtf8, randomBytes, toBase64Url, utf8 } from './base64url';

/**
 * The one shape in which anything private leaves this browser.
 *
 *     pmp1.<nonce>.<ciphertext>
 *
 * AES-256-GCM, a fresh 96-bit nonce per value, and the tag appended to the ciphertext the way
 * WebCrypto returns it. The version prefix is there so that a second scheme can be added later
 * without every stored value becoming ambiguous: a reader looks at the prefix first and refuses what
 * it does not know, rather than guessing at bytes.
 *
 * WHY THERE IS ASSOCIATED DATA
 *
 * GCM proves that the ciphertext was not altered. It does not prove that it is the ciphertext that
 * belongs here - a value lifted from one field and dropped into another decrypts perfectly well,
 * because it was sealed under the same key. So every envelope is bound to the key it was written
 * under and to what it is for, and opening it requires naming both. A folder name cannot be
 * substituted for an entry, an entry cannot be substituted for the wrap around the master key, and a
 * blob written under a key that has since been replaced fails as authentication rather than as
 * nonsense.
 *
 * WHY THE PLAINTEXT CARRIES A BYTE IN FRONT
 *
 * PGN is extremely repetitive and deflates to roughly a third of its size, which matters when an
 * account has 2 MB and base64 adds a third back on top of whatever is left. Compression is not
 * always available - CompressionStream is absent in a few environments and in some test runners - so
 * the first byte of the plaintext says which of the two this is. It is inside the seal, so it is not
 * something an observer learns; what an observer learns is the length, which they would learn
 * anyway.
 */

const PREFIX = 'pmp1';

const NONCE_BYTES = 12;

const RAW = 0;
const DEFLATE = 1;

/** What an envelope is for. Half of what binds it in place; see the note above. */
export type EnvelopePurpose =
	| 'item'
	| 'collection-name'
	| 'wrap:password'
	| 'wrap:recovery';

export class EnvelopeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EnvelopeError';
	}
}

export async function seal(
	key: CryptoKey,
	keyId: string,
	purpose: EnvelopePurpose,
	plaintext: string,
): Promise<string> {
	const nonce = randomBytes(NONCE_BYTES);
	const body = await pack(plaintext);

	const sealed = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce, additionalData: associatedData(keyId, purpose) },
		key,
		body,
	);

	return `${PREFIX}.${toBase64Url(nonce)}.${toBase64Url(new Uint8Array(sealed))}`;
}

export async function open(
	key: CryptoKey,
	keyId: string,
	purpose: EnvelopePurpose,
	envelope: string,
): Promise<string> {
	const parts = envelope.split('.');
	if (parts.length !== 3 || parts[0] !== PREFIX) {
		throw new EnvelopeError('This value is not in a format this version can read');
	}

	let opened: ArrayBuffer;
	try {
		opened = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: fromBase64Url(parts[1]), additionalData: associatedData(keyId, purpose) },
			key,
			fromBase64Url(parts[2]),
		);
	} catch {
		/**
		 * One message for every way this fails, because every way it fails means the same thing to
		 * the person: the key in hand does not open this. Distinguishing "wrong key" from "altered
		 * ciphertext" would be telling whoever altered it which it was.
		 */
		throw new EnvelopeError('This could not be decrypted with the key for this account');
	}

	return unpack(new Uint8Array(opened));
}

/** Whether a string is shaped like an envelope. Used to tell a sealed field from a legacy one. */
export function isEnvelope(value: string | null | undefined): boolean {
	return typeof value === 'string' && /^pmp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function associatedData(keyId: string, purpose: EnvelopePurpose): Bytes {
	return utf8(`${PREFIX}|${keyId}|${purpose}`);
}

async function pack(plaintext: string): Promise<Bytes> {
	const body = utf8(plaintext);
	const compressed = await deflate(body);

	/**
	 * Only when it actually helps. Short values - a folder name - come out longer compressed, and a
	 * document that is mostly engine output does not compress at all.
	 */
	if (compressed === null || compressed.length >= body.length) {
		return prefixed(RAW, body);
	}
	return prefixed(DEFLATE, compressed);
}

async function unpack(body: Bytes): Promise<string> {
	if (body.length === 0) {
		throw new EnvelopeError('This value decrypted to nothing');
	}

	const content = body.subarray(1);
	switch (body[0]) {
		case RAW:
			return fromUtf8(content);
		case DEFLATE: {
			const expanded = await inflate(content);
			if (expanded === null) {
				throw new EnvelopeError('This value is compressed and this browser cannot expand it');
			}
			return fromUtf8(expanded);
		}
		default:
			throw new EnvelopeError('This value is in a format this version cannot read');
	}
}

function prefixed(marker: number, body: Uint8Array): Bytes {
	const out = new Uint8Array(body.length + 1);
	out[0] = marker;
	out.set(body, 1);
	return out;
}

/**
 * Compression is an optimisation and is never allowed to be a failure.
 *
 * It is attempted, and anything that goes wrong - the API missing, a stream refusing, a test
 * environment whose primitives are half-implemented - answers null and the value is sealed
 * uncompressed. The marker byte in front of the plaintext records which of the two happened, so a
 * browser that cannot compress still writes something every other browser can open.
 */
async function deflate(body: Bytes): Promise<Bytes | null> {
	if (typeof CompressionStream === 'undefined') {
		return null;
	}
	try {
		return await pump(new CompressionStream('deflate-raw'), body);
	} catch {
		return null;
	}
}

/**
 * Expanding is the opposite: a value that says it is compressed and will not expand is a value that
 * cannot be read, and that has to surface rather than be papered over. Only the API being absent
 * answers null, which unpack() turns into a message naming the real problem.
 */
async function inflate(body: Uint8Array): Promise<Bytes | null> {
	if (typeof DecompressionStream === 'undefined') {
		return null;
	}
	return pump(new DecompressionStream('deflate-raw'), body);
}

/**
 * Pushes bytes through a transform stream and collects what comes out.
 *
 * Written against ReadableStream and WritableStream directly rather than through
 * `new Blob([body]).stream()`, which is shorter and was what this used to do - and which assumes a
 * Blob implementation with a stream() method. Node has one, browsers have one, jsdom does not, so
 * the short version turned every seal into a TypeError under the test environment the rest of the
 * suite runs in. The primitives used here are the ones CompressionStream is defined in terms of, so
 * anything that has the transform has these.
 *
 * The write is deliberately not awaited before reading starts: a transform stream applies
 * backpressure, so awaiting a write large enough to fill its queue would wait for a reader that has
 * not been started yet.
 */
async function pump(through: GenericTransformStream, body: Uint8Array): Promise<Bytes> {
	const writer = through.writable.getWriter();
	void writer.write(body).then(
		() => writer.close(),
		() => undefined,
	);

	const reader = through.readable.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;

	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		chunks.push(value);
		length += value.length;
	}

	const out = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}
