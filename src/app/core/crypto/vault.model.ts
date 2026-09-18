/** The account's key material, as the backend sends and receives it. */

export type AuthProtocol = 'PASSWORD' | 'SECRET';

/** What GET /api/auth/prelogin answers: how to turn the typed password into what /login expects. */
export interface Prelogin {
	readonly protocol: AuthProtocol;
	/** The KDF descriptor, as stored. Parsed by parseKdf; never trusted to be anything in particular. */
	readonly kdf: string;
}

/** What POST-ing key material looks like. Every field is an opaque string to the server. */
export interface VaultMaterial {
	readonly keyId: string;
	readonly kdf: string;
	readonly passwordWrap: string;
	readonly recoveryWrap: string;
}

export interface VaultView extends VaultMaterial {
	readonly createdAt: string | null;
	/** When the recovery code was last replaced. What the profile prints next to the button. */
	readonly updatedAt: string | null;
	/** Null until the person has confirmed they wrote a recovery code down. */
	readonly acknowledgedAt: string | null;
}

/**
 * The subset a password reset link is given.
 *
 * The password wrap is deliberately absent: that path never opens it - it opens the recovery wrap,
 * or it makes a new key - and sending it would hand whoever holds the link something to attack
 * offline for a password its owner may well have reused somewhere else.
 */
export interface ResetVaultView {
	readonly keyId: string;
	readonly kdf: string;
	readonly recoveryWrap: string;
}

/** What is needed to open a recovery wrap, which both VaultView and ResetVaultView satisfy. */
export type RecoverableVault = Pick<ResetVaultView, 'keyId' | 'kdf' | 'recoveryWrap'>;

/**
 * A vault that has just been created, with the one thing the server never sees and the person only
 * ever will: the recovery code, in the grouped form it should be written down in.
 *
 * It exists as a return type so that the code cannot be quietly dropped. Whoever calls
 * VaultService.create has to decide what to do with this field, and the only correct answer is to
 * put it in front of the person before they go any further.
 */
export interface NewVault {
	readonly material: VaultMaterial;
	readonly authSecret: string;
	readonly recoveryCode: string;
}
