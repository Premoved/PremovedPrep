import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, from, map, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
	AuthResponse,
	RegisterResponse,
	ResetContext,
	SessionSummary,
	SubscriptionView,
	UserSummary,
} from '../models/user.model';
import { SessionService } from '../auth/session.service';
import { CaptchaAnswer } from '../captcha/captcha.model';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsEvent } from '../analytics/analytics.events';
import { VaultService } from '../crypto/vault.service';
import { VaultMigrationService } from '../crypto/vault-migration.service';
import { DEFAULT_KDF, deriveFromPassword, parseKdf } from '../crypto/kdf';
import { VaultMaterial, VaultView } from '../crypto/vault.model';

/**
 * Authentication and account API.
 *
 * THE PASSWORD STOPS HERE
 *
 * Every method below that takes a password turns it into two values before anything is sent: an
 * authentication secret, which goes to the server in the field the password used to occupy, and a
 * key that opens the account's vault, which does not. See kdf.ts for why that split is the whole of
 * the guarantee - without it, the server would hold everything it needs to decrypt the account for
 * one moment per sign-in, and a promise not to keep it.
 *
 * A caller passes a password to these methods exactly as before. What changed is that the password
 * has nowhere else to go from here.
 *
 * withCredentials is set on every call here and nowhere else in the application: this is the only
 * path on which the refresh cookie is sent, set or cleared.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
	private readonly http = inject(HttpClient);
	private readonly analytics = inject(AnalyticsService);
	private readonly session = inject(SessionService);
	private readonly vault = inject(VaultService);
	private readonly migration = inject(VaultMigrationService);
	private readonly baseUrl = `${environment.apiBaseUrl}/auth`;

	readonly currentUser = this.session.currentUser;
	readonly isLoggedIn = this.session.isLoggedIn;

	isAuthenticated(): boolean {
		return this.session.isLoggedIn();
	}

	/**
	 * Creates the account and its key material together. Does not sign in.
	 *
	 * A recovery code is made here and deliberately not returned. It cannot survive the trip through
	 * the inbox and back - registering and first signing in are two visits, often two days and
	 * sometimes two browsers apart - and keeping it in between would mean storing the one thing that
	 * must never be stored. The first sign-in replaces it with one the person is actually shown; see
	 * VaultService.ensureRecoveryCode.
	 */
	register(
		username: string,
		email: string,
		password: string,
		acceptedTerms: boolean,
		captcha?: CaptchaAnswer,
	): Observable<RegisterResponse> {
		return from(this.vault.create(password, email, DEFAULT_KDF)).pipe(
			switchMap((created) =>
				this.http
					.post<RegisterResponse>(
						`${this.baseUrl}/register`,
						{
							username,
							email,
							secret: created.authSecret,
							vault: created.material,
							acceptedTerms,
							captcha,
						},
						{ withCredentials: true },
					)
					.pipe(tap(() => this.analytics.capture(AnalyticsEvent.userRegistered))),
			),
		);
	}

	/**
	 * Confirms the address. It no longer signs the person in: a mailed link carries no password, so
	 * the session it used to open would have had no key behind it and every file would have been
	 * unreadable. Confirming now ends at the sign-in form, which is where the key comes from.
	 */
	verifyEmail(token: string): Observable<void> {
		return this.http.post<void>(`${this.baseUrl}/verify-email`, { token }, { withCredentials: true });
	}

	resendVerification(email: string, captcha?: CaptchaAnswer) {
		return this.http.post<void>(`${this.baseUrl}/verify-email/resend`, { email, captcha }, { withCredentials: true });
	}

	forgotPassword(email: string, captcha?: CaptchaAnswer) {
		return this.http.post<void>(`${this.baseUrl}/forgot-password`, { email, captcha }, { withCredentials: true });
	}

	/** Whose account a reset link belongs to, and the wraps to re-seal. Does not spend the link. */
	resetContext(token: string): Observable<ResetContext> {
		return this.http.get<ResetContext>(`${this.baseUrl}/reset-password/context`, {
			params: { token },
			withCredentials: true,
		});
	}

	/**
	 * Spends a reset link.
	 *
	 * `recoveryCode` is one of the three things that decide what this is - see rewrapForReset. With
	 * it, or with this browser already holding the key, the old master key is re-sealed under the new
	 * password and the account's contents survive. With neither, a new master key is made and
	 * everything the account had stored is deleted, because it was sealed under a key nobody has.
	 *
	 * The destructive case is not a failure mode to be worked around. It is what a reset means when
	 * the server genuinely cannot read your files.
	 */
	resetPassword(token: string, newPassword: string, recoveryCode: string | null): Observable<ResetOutcome> {
		return this.resetContext(token).pipe(
			switchMap((context) => from(this.rewrapForReset(context, newPassword, recoveryCode))),
			switchMap((plan) =>
				this.http
					.post<void>(
						`${this.baseUrl}/reset-password`,
						{ token, newSecret: plan.secret, vault: plan.material, discardData: plan.discardData },
						{ withCredentials: true },
					)
					.pipe(map(() => ({ keptFiles: !plan.discardData }))),
			),
			/**
			 * The key is let go whichever way this went. The reset screen has no session, so nothing
			 * remembered it, but leaving a master key in the tab's memory after the one operation that
			 * needed it is not a thing to leave to the next reload.
			 */
			tap({ finalize: () => void this.vault.lock() }),
		);
	}

	/** Whether this is the account's recovery code. Certain, not a guess - see VaultService. */
	verifyRecoveryCode(code: string, context: ResetContext): Promise<boolean> {
		return this.vault.verifyRecoveryCode(code, context.email, context.vault);
	}

	/**
	 * Whether the account is signed in and unlocked in THIS browser, which is what lets a reset keep
	 * the files without a recovery code. The reset screen asks before it decides what to show.
	 */
	unlockedHere(): boolean {
		return this.vault.unlocked();
	}

	/**
	 * Whether this account still owes its owner a recovery code they have actually seen. The profile
	 * asks, so that the dialog opens by itself rather than waiting to be found.
	 */
	readonly pendingRecoveryCode = this.vault.pendingRecoveryCode;

	/** The account's key material, for the one date the profile prints. Never the code itself. */
	vaultSummary(): Observable<VaultView> {
		return from(this.vault.vault());
	}

	/** The person says they have kept it. */
	acknowledgeRecoveryCode(): Promise<void> {
		return this.vault.acknowledgeRecoveryCode();
	}

	/** A new recovery code. The old one stops working; nothing stored is touched. */
	replaceRecoveryCode(password: string): Observable<string> {
		const email = this.session.currentUser()?.email;
		if (email === undefined) {
			throw new Error('There is no account signed in');
		}
		return from(this.vault.replaceRecoveryCode(password, email));
	}

	/**
	 * Signing in.
	 *
	 * Three things happen in order, and all three are this method's business because only here does
	 * the password exist: the account is asked how it expects to be signed in to, the derivation is
	 * done, and the vault is opened with the half that was not sent.
	 *
	 * An account that predates encryption takes the longer path - it signs in with the password
	 * itself, adopts key material on the spot, and starts sealing what it already had. See
	 * VaultMigrationService.
	 */
	login(email: string, password: string, keepSignedIn: boolean, captcha?: CaptchaAnswer): Observable<AuthResponse> {
		return from(this.signIn(email, password, keepSignedIn, captcha));
	}

	/** Ends the session on the server as well, and takes the key out of this browser with it. */
	logout(): void {
		this.analytics.capture(AnalyticsEvent.userSignedOut);
		this.session.end().subscribe();
	}

	subscription() {
		return this.http.get<SubscriptionView>(`${this.baseUrl}/me/subscription`, { withCredentials: true });
	}

	changeUsername(username: string) {
		return this.http
			.patch<UserSummary>(`${this.baseUrl}/me/username`, { username }, { withCredentials: true })
			.pipe(tap((user) => this.session.setUser(user)));
	}

	/**
	 * Irreversible, and the reason the caller types their own username: the server checks it again
	 * before deleting anything.
	 */
	deleteAccount(username: string) {
		return this.http.delete<void>(`${this.baseUrl}/me`, { body: { username }, withCredentials: true });
	}

	/**
	 * Changing the password.
	 *
	 * The master key does not change - it is re-sealed under the new password - so not one stored
	 * entry is rewritten and nothing has to be re-uploaded. The recovery code keeps working, because
	 * it wraps the same key and was never involved.
	 *
	 * Answers with a new session, as it always did: the change ends every session on the account,
	 * this one included.
	 */
	changePassword(currentPassword: string, newPassword: string): Observable<AuthResponse> {
		const email = this.session.currentUser()?.email;
		if (email === undefined) {
			throw new Error('There is no account signed in');
		}

		return from(this.vault.vault()).pipe(
			switchMap((stored) =>
				from(
					Promise.all([
						deriveFromPassword(currentPassword, email, parseKdf(stored.kdf)),
						this.vault.rewrapForNewPassword(newPassword, email, stored),
					]),
				),
			),
			switchMap(([current, replacement]) =>
				this.http.post<AuthResponse>(
					`${this.baseUrl}/me/password`,
					{
						currentSecret: current.authSecret,
						newSecret: replacement.authSecret,
						vault: replacement.material,
					},
					{ withCredentials: true },
				),
			),
			tap((res) => this.signedIn(res)),
		);
	}

	/** Every browser currently signed in to this account, this one marked. */
	sessions(): Observable<SessionSummary[]> {
		return this.http.get<SessionSummary[]>(`${this.baseUrl}/me/sessions`, { withCredentials: true });
	}

	/** One other browser. Ending this one is logout(), which also clears the cookie here. */
	endSession(id: number): Observable<void> {
		return this.http.delete<void>(`${this.baseUrl}/me/sessions/${id}`, { withCredentials: true });
	}

	endOtherSessions(): Observable<void> {
		return this.http.post<void>(`${this.baseUrl}/me/sessions/end-others`, {}, { withCredentials: true });
	}

	restoreSession(): Promise<void> {
		return this.session.restore();
	}

	/** For a call that needs a token still valid when it lands rather than when it was asked for. */
	freshAccessToken(): Promise<string | null> {
		return this.session.freshToken();
	}

	// -----------------------------------------------------------------

	private async signIn(
		email: string,
		password: string,
		keepSignedIn: boolean,
		captcha?: CaptchaAnswer,
	): Promise<AuthResponse> {
		const prelogin = await this.vault.prelogin(email);
		const kdf = parseKdf(prelogin.kdf);

		if (prelogin.protocol === 'PASSWORD') {
			return this.signInLegacy(email, password, keepSignedIn, kdf, captcha);
		}

		const derived = await deriveFromPassword(password, email, kdf);
		const response = await this.post(email, derived.authSecret, keepSignedIn, captcha);
		this.signedIn(response);

		/**
		 * After the session, because reading the wraps needs one. A failure here leaves the person
		 * signed in and locked, which is a state the application draws - it is not a reason to undo a
		 * sign-in that succeeded.
		 */
		const stored = await this.vault.vault();
		await this.vault.unlockWithDerived(derived.vaultKey, stored, response.user.id);

		/**
		 * The account may never have been shown a recovery code - registration makes one that nobody
		 * sees, because it cannot survive the trip through the inbox. This is the first moment the
		 * password and an unlocked vault are together again, so it is the moment to make a real one.
		 * A failure here is not a failed sign-in: the person is in, and the next sign-in tries again.
		 */
		try {
			await this.vault.ensureRecoveryCode(password, email);
		} catch (error) {
			console.warn('Could not prepare a recovery code for this account', error);
		}

		return response;
	}

	/**
	 * An account written before V23.
	 *
	 * It signs in with the password itself, because that is still what its stored hash is of. Then,
	 * in the one moment its browser holds the password, it creates key material, swaps its credential
	 * for the derived secret, and begins sealing what it already had. There is no other moment this
	 * can happen: the server cannot do it, and a later sign-in would face the same problem.
	 *
	 * The code created during adoption is not shown, for the same reason a new account's is not: the
	 * step after it replaces it with one that will be.
	 */
	private async signInLegacy(
		email: string,
		password: string,
		keepSignedIn: boolean,
		kdf: ReturnType<typeof parseKdf>,
		captcha?: CaptchaAnswer,
	): Promise<AuthResponse> {
		const response = await this.post(email, password, keepSignedIn, captcha);
		this.signedIn(response);

		await this.migration.adopt(email, password, kdf, response.user.id);

		/** The same last step every other sign-in takes: an account owes its owner a code it has seen. */
		try {
			await this.vault.ensureRecoveryCode(password, email);
		} catch (error) {
			console.warn('Could not prepare a recovery code for this account', error);
		}
		return response;
	}

	private async post(
		email: string,
		secret: string,
		keepSignedIn: boolean,
		captcha?: CaptchaAnswer,
	): Promise<AuthResponse> {
		return firstValueFrom(
			this.http.post<AuthResponse>(
				`${this.baseUrl}/login`,
				{ email, secret, keepSignedIn, captcha },
				{ withCredentials: true },
			),
		);
	}

	/**
	 * The three ways a reset can go, in the order they are worth trying.
	 *
	 * First: this browser is already signed in and unlocked for this account, so the master key is
	 * here and no recovery code is needed at all. That covers the common case of forgetting a password
	 * while still signed in somewhere, and it is checked first because it asks the person for nothing.
	 *
	 * Then: the recovery code, which opens the second wrapping around the same key.
	 *
	 * Last: neither, which is a new key and the deletion of everything sealed under the old one. The
	 * code made for that new key is not shown here and does not need to be: the server clears the
	 * account's acknowledgement along with it, so the next sign-in makes a real one and puts it in
	 * front of the person - the same path a new account takes.
	 */
	private async rewrapForReset(
		context: ResetContext,
		newPassword: string,
		recoveryCode: string | null,
	): Promise<ResetPlan> {
		const fromThisBrowser = await this.vault.rewrapFromUnlocked(newPassword, context.email, context.vault);
		if (fromThisBrowser !== null) {
			return { ...fromThisBrowser, secret: fromThisBrowser.authSecret, discardData: false };
		}

		if (recoveryCode !== null) {
			await this.vault.unlockWithRecoveryCode(recoveryCode, context.email, context.vault, null);
			const rewrapped = await this.vault.rewrapForNewPassword(newPassword, context.email, context.vault);
			return { secret: rewrapped.authSecret, material: rewrapped.material, discardData: false };
		}

		const created = await this.vault.create(newPassword, context.email, parseKdf(context.vault.kdf));
		return { secret: created.authSecret, material: created.material, discardData: true };
	}

	private signedIn(response: AuthResponse): void {
		this.session.apply(response);
		this.analytics.capture(AnalyticsEvent.userSignedIn);
	}
}

/** What a reset did. */
export interface ResetOutcome {
	readonly keptFiles: boolean;
}

interface ResetPlan {
	readonly secret: string;
	readonly material: VaultMaterial;
	readonly discardData: boolean;
}
