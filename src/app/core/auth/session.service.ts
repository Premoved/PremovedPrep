import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, finalize, firstValueFrom, map, of, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthResponse, UserSummary } from '../models/user.model';
import { AnalyticsService } from '../analytics/analytics.service';
import { ThemeService } from '../services/theme.service';
import { VaultService } from '../crypto/vault.service';
import {
	SKIP_SESSION_RETRY,
	accessTokenFresh,
	clearAccessToken,
	readAccessToken,
	storeAccessToken,
} from './access-token';

/**
 * What being signed in is: an access token in memory, the account it belongs to, and the refresh
 * cookie behind both. Everything that starts, renews or ends a session goes through here, so one
 * place knows how the three move together.
 *
 * AuthService is the surface the components call; this is the state underneath it. They are apart
 * because the interceptor needs the renewal and must not drag the rest of the account API - and its
 * dependencies - into every request it makes.
 *
 * SINCE END-TO-END ENCRYPTION THERE ARE THREE STATES, NOT TWO
 *
 * Signed out; signed in and unlocked; and signed in and locked. The third is what a restored session
 * is in a browser that has no key - a new device, a cleared profile, a private window - and it is a
 * normal state rather than a failure: the account is reachable and its contents are not. This class
 * owns the first two transitions and asks VaultService about the third, because the key's lifetime
 * is exactly the session's: it is looked for when a session is restored, and it is destroyed when
 * one ends, however it ends.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
	private readonly http = inject(HttpClient);
	private readonly analytics = inject(AnalyticsService);
	private readonly theme = inject(ThemeService);
	private readonly vault = inject(VaultService);
	private readonly baseUrl = `${environment.apiBaseUrl}/auth`;

	private readonly _currentUser = signal<UserSummary | null>(null);
	readonly currentUser = this._currentUser.asReadonly();
	readonly isLoggedIn = computed(() => this._currentUser() !== null);

	/** The renewal in flight, so ten requests failing at once cause one refresh and not ten. */
	private renewal: Observable<string | null> | null = null;
	private ahead: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		/**
		 * Tabs no longer share the token - it is in each tab's memory - but they do share the cookie,
		 * so a sign-in in one tab is a session the others can pick up by asking for it. This is a bare
		 * "something changed" flag; the token itself is never written anywhere a script can read.
		 */
		window.addEventListener('storage', (event) => {
			if (event.key !== SIGNAL_KEY) {
				return;
			}
			const changed = state(event.newValue);
			if (changed === 'out') {
				this.forget();
			} else if (changed === 'in' && !this.isLoggedIn()) {
				this.renew().subscribe();
			}
		});

		/**
		 * A laptop that was asleep comes back with a token that expired hours ago and a timer that did
		 * not fire. Getting ahead of the first request avoids a visible failure on the way back.
		 */
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible' && this.isLoggedIn() && !accessTokenFresh()) {
				this.renew().subscribe();
			}
		});
	}

	/**
	 * Startup, and every reload: the cookie is all that survived, so ask what it is worth - and then
	 * look for the key this browser was holding for that account.
	 *
	 * Not finding one is not an error. It leaves the application signed in and locked, which the
	 * screens draw as a prompt for the password rather than as a row of failures.
	 */
	async restore(): Promise<void> {
		await firstValueFrom(this.renew());
		await this.restoreVault();
	}

	/**
	 * Looks for the key this browser was holding for the account the cookie just restored.
	 *
	 * NOT FINDING ONE ENDS THE SESSION, ON PURPOSE
	 *
	 * A session without a key is signed in and unable to read anything, and there is no honest screen
	 * for that: a grid of folders that will not open reads as data loss, and a second password prompt
	 * on top of an apparently live session reads as a bug. Signing out locally turns a state nobody
	 * can explain into one everybody already knows - the sign-in form - and typing the password there
	 * produces both halves at once.
	 *
	 * It is rare. The cookie and the key are written together and cleared together; they come apart
	 * only when the browser evicts one and not the other, which is what Safari and Firefox do to
	 * IndexedDB after a week or so of not visiting while a long-lived cookie survives, and what a
	 * private window does on its own terms.
	 */
	private async restoreVault(): Promise<void> {
		const user = this._currentUser();
		if (user === null) {
			return;
		}

		try {
			if (await this.vault.restore(user.id, await this.vault.vault())) {
				return;
			}
		} catch {
			/** Unreachable or unreadable key material. Treated the same as not having the key. */
		}

		this.forget();
	}

	apply(response: AuthResponse): void {
		storeAccessToken(response.token, response.expiresInSeconds);
		this._currentUser.set(response.user);
		this.analytics.identify(response.user.id);
		announce('in');
		this.scheduleRenewal(response.expiresInSeconds * 1000);
	}

	/**
	 * Exchanges the cookie for a new access token, rotating the cookie in the same call. Null means
	 * there is no session: either there never was one, or it has been ended somewhere else.
	 */
	renew(): Observable<string | null> {
		if (this.renewal === null) {
			this.renewal = this.http
				.post<AuthResponse>(`${this.baseUrl}/refresh`, {}, { withCredentials: true, context: skip() })
				.pipe(
					map((response) => {
						this.apply(response);
						return response.token;
					}),
					catchError((error: unknown) => {
						if (error instanceof HttpErrorResponse && error.status === 401) {
							/** Answered, and the answer is no. */
							this.forget();
						} else {
							/** Unreachable, not refused. Keep the account on screen and try again shortly. */
							this.scheduleIn(RETRY_MS);
						}
						return of(null);
					}),
					finalize(() => {
						this.renewal = null;
					}),
					shareReplay({ bufferSize: 1, refCount: false }),
				);
		}
		return this.renewal;
	}

	/**
	 * Signing out. The server call is the half that never used to happen: until now this cleared the
	 * browser's copy and left the token working on the other side until it expired.
	 */
	end(): Observable<void> {
		const request = this.http
			.post<void>(`${this.baseUrl}/logout`, {}, { withCredentials: true, context: skip() })
			.pipe(catchError(() => of(undefined as void)));

		/** Before the answer: the person asked to be signed out, not to wait for the network. */
		this.forget();
		announce('out');
		return request;
	}

	/** A token with life left in it, for a caller that cannot retry: renewed first if it is nearly out. */
	async freshToken(): Promise<string | null> {
		if (accessTokenFresh(60_000)) {
			return readAccessToken();
		}
		return firstValueFrom(this.renew());
	}

	/** Local only: what is left when a session has ended, however it ended. */
	forget(): void {
		const wasSignedIn = this._currentUser() !== null;

		clearAccessToken();

		/**
		 * The key goes with the session, always and immediately - before the network call that ends the
		 * session on the other side, and whether or not that call succeeds. A session that has ended
		 * and a key still sitting in this browser's store is the one combination that must not exist.
		 */
		void this.vault.lock();
		this._currentUser.set(null);
		this.cancelRenewal();
		this.analytics.reset();

		/**
		 * The theme on screen came from the account that has just left, and this is one browser. Only
		 * on the way out of a session: a visitor who was never signed in keeps whatever they picked,
		 * and this method also runs on the startup refresh that answers "nobody is signed in".
		 */
		if (wasSignedIn) {
			this.theme.reset();
		}
	}

	setUser(user: UserSummary): void {
		this._currentUser.set(user);
	}

	private scheduleRenewal(lifetimeMs: number): void {
		/** A minute early, and never sooner than ten seconds, so a very short lifetime cannot spin. */
		this.scheduleIn(Math.max(10_000, lifetimeMs - 60_000));
	}

	private scheduleIn(delayMs: number): void {
		this.cancelRenewal();
		this.ahead = setTimeout(() => this.renew().subscribe(), delayMs);
	}

	private cancelRenewal(): void {
		if (this.ahead !== null) {
			clearTimeout(this.ahead);
			this.ahead = null;
		}
	}
}

/** Not the token, and never the token: one word saying that this browser's session changed. */
const SIGNAL_KEY = 'premovedprep.session';
const RETRY_MS = 60_000;

function announce(what: 'in' | 'out'): void {
	try {
		/** The timestamp is what makes the value differ; an unchanged value fires no storage event. */
		localStorage.setItem(SIGNAL_KEY, `${what}:${Date.now()}`);
	} catch {
		// Private browsing, or storage turned off. The cross-tab notice is a convenience, not the session.
	}
}

function state(value: string | null): string {
	return (value ?? '').split(':')[0];
}

function skip(): HttpContext {
	return new HttpContext().set(SKIP_SESSION_RETRY, true);
}
