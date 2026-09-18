import { randomBytes } from './base64url';

/**
 * The code that is the only way back into an account whose password has been forgotten.
 *
 * Under end-to-end encryption a password reset cannot restore anything by itself: the server holds
 * the master key only in wrapped form and cannot open it, so a new password gives a person their
 * account back and not their work. This code is the second wrapping. It is shown once, at
 * registration, and it is the difference between "reset your password" and "start again".
 *
 * WHAT THE ALPHABET IS FOR
 *
 * Crockford's base32: no I, L, O or U. The first three are the characters people confuse with 1, 1
 * and 0 when copying a code off a screen onto paper, and U is left out so that the alphabet cannot
 * accidentally spell a word. Reading is case-insensitive and folds the confusable characters back,
 * so a code typed as "l" opens an account that was given "1".
 *
 * 26 characters of this alphabet is 130 bits. That is well past the point where guessing is the
 * attack anyone would choose, which matters because this code opens the vault on its own: it is not
 * a second factor behind a password, it is an alternative to one.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** What a reader folds before looking a character up. */
const CONFUSABLE: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0', U: 'V' };

const LENGTH = 26;

const GROUP = 5;

/**
 * A new code, grouped for reading aloud and for writing down:
 *
 *     K4M2P-7XQW0-V3HRN-B8FTY-JZ1CS-9D
 *
 * Rejection sampling rather than a modulo over random bytes: the alphabet is 32 characters and a
 * byte is 256 values, so the modulo happens to be uniform here - but it is uniform by coincidence of
 * this alphabet's length, and a later change to the alphabet would silently bias the code. Masking
 * to five bits is uniform for the reason it says.
 */
export function newRecoveryCode(): string {
	const bytes = randomBytes(LENGTH);
	let code = '';
	for (let i = 0; i < LENGTH; i++) {
		code += ALPHABET[bytes[i] & 0x1f];
	}
	return group(code);
}

/**
 * The typed form, folded back to what was generated. Null when it is not a code at all, which is
 * what tells the reset screen to say so before spending a minute on a key derivation that was never
 * going to work.
 */
export function readRecoveryCode(typed: string): string | null {
	const stripped = typed
		.toUpperCase()
		.replace(/[\s-]/g, '')
		.split('')
		.map((character) => CONFUSABLE[character] ?? character)
		.join('');

	if (stripped.length !== LENGTH) {
		return null;
	}
	for (const character of stripped) {
		if (!ALPHABET.includes(character)) {
			return null;
		}
	}
	return stripped;
}

export function group(code: string): string {
	return (code.match(new RegExp(`.{1,${GROUP}}`, 'g')) ?? []).join('-');
}
