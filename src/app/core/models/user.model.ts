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

export interface AuthResponse {
	readonly token: string;
	readonly expiresInSeconds: number;
	readonly user: UserSummary;
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
