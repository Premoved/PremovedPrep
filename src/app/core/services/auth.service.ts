import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthResponse, RegisterResponse, SessionSummary, SubscriptionView, UserSummary } from '../models/user.model';
import { SessionService } from '../auth/session.service';
import { CaptchaAnswer } from '../captcha/captcha.model';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsEvent } from '../analytics/analytics.events';

/**
 * Authentication and account API. The calls taking a `captcha` argument can be refused with a bot
 * check. Session state itself - the token, the account, the refresh cookie - belongs to
 * SessionService; this is the surface the components call.
 *
 * withCredentials is set on every call here and nowhere else in the application: this is the only
 * path on which the refresh cookie is sent, set or cleared.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
	private readonly http = inject(HttpClient);
	private readonly analytics = inject(AnalyticsService);
	private readonly session = inject(SessionService);
	private readonly baseUrl = `${environment.apiBaseUrl}/auth`;

	readonly currentUser = this.session.currentUser;
	readonly isLoggedIn = this.session.isLoggedIn;

	isAuthenticated(): boolean {
		return this.session.isLoggedIn();
	}

	/** Creates the account. Does not sign in. The server refuses a registration with acceptedTerms false. */
	register(username: string, email: string, password: string, acceptedTerms: boolean, captcha?: CaptchaAnswer) {
		return this.http
			.post<RegisterResponse>(
				`${this.baseUrl}/register`,
				{ username, email, password, acceptedTerms, captcha },
				{ withCredentials: true },
			)
			.pipe(tap(() => this.analytics.capture(AnalyticsEvent.userRegistered)));
	}

	verifyEmail(token: string) {
		return this.http
			.post<AuthResponse>(`${this.baseUrl}/verify-email`, { token }, { withCredentials: true })
			.pipe(tap((res) => this.signedIn(res)));
	}

	resendVerification(email: string, captcha?: CaptchaAnswer) {
		return this.http.post<void>(`${this.baseUrl}/verify-email/resend`, { email, captcha }, { withCredentials: true });
	}

	forgotPassword(email: string, captcha?: CaptchaAnswer) {
		return this.http.post<void>(`${this.baseUrl}/forgot-password`, { email, captcha }, { withCredentials: true });
	}

	resetPassword(token: string, newPassword: string) {
		return this.http.post<void>(`${this.baseUrl}/reset-password`, { token, newPassword }, { withCredentials: true });
	}

	/** keepSignedIn false gives the shorter of the two sessions: the cookie goes with the browser. */
	login(email: string, password: string, keepSignedIn: boolean, captcha?: CaptchaAnswer) {
		return this.http
			.post<AuthResponse>(
				`${this.baseUrl}/login`,
				{ email, password, keepSignedIn, captcha },
				{ withCredentials: true },
			)
			.pipe(tap((res) => this.signedIn(res)));
	}

	/** Ends the session on the server as well, which is what signing out did not use to do. */
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
	 * Answers with a new session, not a summary: changing the password ends every session on the
	 * account, this one included, so a replacement has to come back with it.
	 */
	changePassword(currentPassword: string, newPassword: string) {
		return this.http
			.post<AuthResponse>(`${this.baseUrl}/me/password`, { currentPassword, newPassword }, { withCredentials: true })
			.pipe(tap((res) => this.signedIn(res)));
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

	/** For the Desktop Agent handshake, which needs a token that will still be valid when it lands. */
	freshAccessToken(): Promise<string | null> {
		return this.session.freshToken();
	}

	private signedIn(response: AuthResponse): void {
		this.session.apply(response);
		this.analytics.capture(AnalyticsEvent.userSignedIn);
	}
}
