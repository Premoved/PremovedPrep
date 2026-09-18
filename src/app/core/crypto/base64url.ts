/**
 * base64url, unpadded - RFC 4648 §5.
 *
 * Every value this application stores or sends in an envelope is spelled this way rather than in
 * standard base64, for one blunt reason: these strings travel in URLs, in JSON, and through a
 * Postgres CHECK that matches them with a character class, and '+' and '/' are the two characters
 * that behave differently in all three. The padding goes too, because it carries no information and
 * '=' is the third such character.
 */

/**
 * Bytes whose backing buffer is known to be an ArrayBuffer and not a SharedArrayBuffer.
 *
 * WebCrypto's BufferSource excludes the shared case, and since TypeScript 5.7 a plain Uint8Array is
 * generic over which it has - so a value that came out of TextEncoder does not satisfy BufferSource
 * without saying so. Every byte array in this application is a plain one; naming that here is how it
 * is said once rather than with a cast at each of the dozen call sites.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export function toBase64Url(bytes: Uint8Array): string {
	/**
	 * Chunked rather than String.fromCharCode(...bytes): spreading a megabyte-long array into
	 * arguments overflows the call stack, and a saved PGN can be a megabyte.
	 */
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Bytes {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));

	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function utf8(value: string): Bytes {
	const encoded = new TextEncoder().encode(value);
	/** A view over the same memory, not a copy: encode() always allocates a plain ArrayBuffer. */
	return new Uint8Array(encoded.buffer as ArrayBuffer, encoded.byteOffset, encoded.byteLength);
}

export function fromUtf8(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

/** Cryptographically random bytes. The only source of them in this application. */
export function randomBytes(length: number): Bytes {
	return crypto.getRandomValues(new Uint8Array(length));
}
