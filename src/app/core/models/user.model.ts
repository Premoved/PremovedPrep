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

/** How the one plan - "Premoved subscription" - stands for this account. */
export interface SubscriptionView {
	/** Whether it can be bought at all: the application is out, and Stripe is configured. */
	readonly selling: boolean;
	/** What unlocks the desktop application and the larger cloud allowance. */
	readonly active: boolean;
	readonly status: SubscriptionStatus;
	readonly interval: PlanInterval | null;
	/** Minor units: 124 is EUR 1.24. */
	readonly monthlyPriceMinor: number;
	readonly yearlyPriceMinor: number;
	readonly currency: string;
	readonly renewsAt: string | null;
	readonly canceledAt: string | null;
	readonly cancelAtPeriodEnd: boolean;
	/** Whether there is a Stripe customer behind this, and therefore a portal to open. */
	readonly managed: boolean;
	readonly storageQuotaBytes: number;
	/** Whether this account can still start its one free trial. Started from the Desktop App. */
	readonly trialAvailable?: boolean;
	/** When a running or past free trial ends, or null when there never was one. */
	readonly trialEndsAt?: string | null;
	/**
	 * Until when cancelling refunds the first payment in full and ends the plan at once - fourteen
	 * days from the account's first payment. Null once that has passed, or when nothing was paid.
	 */
	readonly refundUntil?: string | null;
}

export type PlanInterval = 'MONTH' | 'YEAR';

/** Where to send the browser next. Every billing endpoint answers with this and nothing else. */
export interface BillingRedirect {
	readonly url: string;
}

export type AppStage = 'PREVIEW' | 'LAUNCHED';

/**
 * Whether this account may run the desktop application, as the server decides it. `reason` is OK,
 * PREVIEW or PLAN - what the refusal is, not why an account was let through.
 */
export interface DesktopAppAccess {
	readonly allowed: boolean;
	readonly reason: 'OK' | 'PREVIEW' | 'PLAN';
	readonly stage: AppStage;
}
