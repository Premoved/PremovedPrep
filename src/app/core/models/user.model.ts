import { ResetVaultView } from '../crypto/vault.model';
import { ThemeName } from '../theme/themes';

export interface UserSummary {
	readonly id: number;
	readonly username: string;
	readonly email: string;
	readonly emailVerified: boolean;
	readonly themePreference: ThemeName;
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

export type AppStage = 'PREVIEW' | 'LAUNCHED';

/** `reason` is what the refusal is (OK, PREVIEW or PLAN), not why an account was let through. */
export interface DesktopAppAccess {
	readonly allowed: boolean;
	readonly reason: 'OK' | 'PREVIEW' | 'PLAN';
	readonly stage: AppStage;
}
