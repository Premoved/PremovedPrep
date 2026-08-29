import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, firstValueFrom, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthResponse, RegisterResponse, SubscriptionView, UserSummary } from '../models/user.model';
import { clearToken, readToken, storeToken } from '../interceptors/auth.interceptor';
import { CaptchaAnswer } from '../captcha/captcha.model';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsEvent } from '../analytics/analytics.events';

/**
 * Authentication and account API. The calls taking a `captcha` argument can be refused with a bot check.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
	private readonly http = inject(HttpClient);
	private readonly analytics = inject(AnalyticsService);
	private readonly baseUrl = `${environment.apiBaseUrl}/auth`;

	private readonly _currentUser = signal<UserSummary | null>(null);
	readonly currentUser = this._currentUser.asReadonly();
	readonly isLoggedIn = computed(() => this._currentUser() !== null);

	isAuthenticated(): boolean {
		return this._currentUser() !== null;
	}

	/** Creates the account. Does not sign in. The server refuses a registration with acceptedTerms false. */
	register(username: string, email: string, password: string, acceptedTerms: boolean, captcha?: CaptchaAnswer) {
		return this.http
			.post<RegisterResponse>(`${this.baseUrl}/register`, { username, email, password, acceptedTerms, captcha })
			.pipe(tap(() => this.analytics.capture(AnalyticsEvent.userRegistered)));
	}

	verifyEmail(token: string) {
		return this.http
			.post<AuthResponse>(`${this.baseUrl}/verify-email`, { token })
			.pipe(tap((res) => this.applySession(res)));
	}

	resendVerification(email: string, captcha?: CaptchaAnswer) {
		return this.http.post<void>(`${this.baseUrl}/verify-email/resend`, { email, captcha });
	}

	forgotPassword(email: string, captcha?: CaptchaAnswer) {
		return this.http.post<void>(`${this.baseUrl}/forgot-password`, { email, captcha });
	}

	resetPassword(token: string, newPassword: string) {
		return this.http.post<void>(`${this.baseUrl}/reset-password`, { token, newPassword });
	}

	login(email: string, password: string, captcha?: CaptchaAnswer) {
		return this.http
			.post<AuthResponse>(`${this.baseUrl}/login`, { email, password, captcha })
			.pipe(tap((res) => this.applySession(res)));
	}

	logout(): void {
		clearToken();
		this._currentUser.set(null);
		this.analytics.capture(AnalyticsEvent.userSignedOut);
		this.analytics.reset();
	}

	subscription() {
		return this.http.get<SubscriptionView>(`${this.baseUrl}/me/subscription`);
	}

	changeUsername(username: string) {
		return this.http
			.patch<UserSummary>(`${this.baseUrl}/me/username`, { username })
			.pipe(tap((user) => this._currentUser.set(user)));
	}

	/**
	 * Irreversible, and the reason the caller types their own username: the server checks it again
	 * before deleting anything.
	 */
	deleteAccount(username: string) {
		return this.http.delete<void>(`${this.baseUrl}/me`, { body: { username } });
	}

	changePassword(currentPassword: string, newPassword: string) {
		return this.http
			.post<UserSummary>(`${this.baseUrl}/me/password`, { currentPassword, newPassword })
			.pipe(tap((user) => this._currentUser.set(user)));
	}

	async restoreSession(): Promise<void> {
		const token = readToken();
		if (!token) {
			return;
		}
		const user = await firstValueFrom(
			this.http.get<UserSummary>(`${this.baseUrl}/me`).pipe(catchError(() => of(null))),
		);
		if (user) {
			this._currentUser.set(user);
			this.analytics.identify(user.id);
		} else {
			clearToken();
		}
	}

	private applySession(res: AuthResponse): void {
		storeToken(res.token);
		this._currentUser.set(res.user);
		this.analytics.identify(res.user.id);
		this.analytics.capture(AnalyticsEvent.userSignedIn);
	}
}
