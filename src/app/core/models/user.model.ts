import { ResetVaultView } from '../crypto/vault.model';

/** The account, as the backend sends it. */

export type SubscriptionStatus = 'FREE' | 'ACTIVE' | 'CANCELED';

export interface UserSummary {
	readonly id: number;
	readonly username: string;
	readonly email: string;
	readonly emailVerified: boolean;
	readonly subscriptionStatus: SubscriptionStatus;
	/** Legacy: nothing on the server counts or enforces this. */
	readonly freeReportsRemaining: number;
	readonly themePreference: 'light' | 'dark';
	readonly boardPreferences: string | null;
}

/** Registering does not sign the user in, so this is not an AuthResponse. */
export interface RegisterResponse {
	readonly email: string;
	/** False when the mail provider refused. The account exists either way. */
	readonly verificationSent: boolean;
}

/**
 * What a password reset link turns out to be for, read without spending it.
 *
 * The address is here because the browser salts its key derivation with it and the person following
 * a link from their inbox has not typed it. The recovery wrap is here because re-sealing the master
 * key under the new password is the only way a reset can leave the account's contents readable. The
 * password wrap is deliberately not - see ResetVaultView.
 */
export interface ResetContext {
	readonly email: string;
	readonly vault: ResetVaultView;
}

/** `token` is the access token. The refresh token is a cookie no script can read. */
export interface AuthResponse {
	readonly token: string;
	readonly expiresInSeconds: number;
	readonly user: UserSummary;
}

/** One browser signed in to this account. */
export interface SessionSummary {
	readonly id: number;
	/** "Chrome on Windows", or null when the browser said nothing useful about itself. */
	readonly device: string | null;
	readonly current: boolean;
	readonly startedAt: string;
	readonly lastUsedAt: string;
}

export interface SubscriptionView {
	readonly selling: boolean;
	readonly entitled: boolean;
	/** Minor units: 299 is EUR 2.99. */
	readonly priceMinor: number;
	readonly currency: string;
	readonly status: SubscriptionStatus;
	readonly renewsAt: string | null;
	readonly canceledAt: string | null;
	readonly refundEligible: boolean;
	readonly refundWindowDays: number;
}
