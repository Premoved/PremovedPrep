import { ResetVaultView } from '../crypto/vault.model';

export type SubscriptionStatus = 'FREE' | 'ACTIVE' | 'CANCELED';

export interface UserSummary {
	readonly id: number;
	readonly username: string;
	readonly email: string;
	readonly emailVerified: boolean;
	readonly subscriptionStatus: SubscriptionStatus;
	// Not incremented or enforced by the server; it always reads as the plan maximum.
	readonly freeReportsRemaining: number;
	readonly themePreference: 'light' | 'dark';
	readonly boardPreferences: string | null;
}

/** Registering does not sign the user in, so this is not an AuthResponse. */
export interface RegisterResponse {
	readonly email: string;
	readonly verificationSent: boolean;
}

/** The browser salts key derivation with `email`; the password wrap is deliberately not here. */
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

export interface SessionSummary {
	readonly id: number;
	readonly device: string | null;
	readonly current: boolean;
	readonly startedAt: string;
	readonly lastUsedAt: string;
}

export interface SubscriptionView {
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
	readonly managed: boolean;
	readonly storageQuotaBytes: number;
	readonly trialAvailable?: boolean;
	readonly trialEndsAt?: string | null;
	/** Fourteen days from the account's first payment; null once passed or when nothing was paid. */
	readonly refundUntil?: string | null;
	// The plan is free for this account: prices are hidden rather than explained.
	readonly complimentary?: boolean;
}

export type PlanInterval = 'MONTH' | 'YEAR';

export interface BillingRedirect {
	readonly url: string;
}

export type AppStage = 'PREVIEW' | 'LAUNCHED';

/** `reason` is what the refusal is (OK, PREVIEW or PLAN), not why an account was let through. */
export interface DesktopAppAccess {
	readonly allowed: boolean;
	readonly reason: 'OK' | 'PREVIEW' | 'PLAN';
	readonly stage: AppStage;
}
