import { HttpContextToken } from '@angular/common/http';

/**
 * The access token, held in this tab's memory and nowhere else.
 *
 * It used to live in localStorage, which meant anything able to run a script on the page could read
 * it and then hold a working credential for as long as it lasted - and that signing out deleted
 * only the browser's copy, because the server had no way to withdraw one. What survives a reload
 * now is the refresh cookie, which is HttpOnly and cannot be read from here at all; this value is
 * fetched back from it on startup and goes when the tab does.
 */
let token: string | null = null;
let expiresAtMs = 0;

export function storeAccessToken(value: string, lifetimeSeconds: number): void {
	token = value;
	expiresAtMs = Date.now() + lifetimeSeconds * 1000;
}

export function readAccessToken(): string | null {
	return token;
}

export function clearAccessToken(): void {
	token = null;
	expiresAtMs = 0;
}

/** Whether the token is still worth sending. Only the server decides; this saves a round trip. */
export function accessTokenFresh(marginMs = 15_000): boolean {
	return token !== null && Date.now() < expiresAtMs - marginMs;
}

/**
 * Set on the two calls that must not be retried through a refresh, because one of them is the
 * refresh and the other is signing out.
 */
export const SKIP_SESSION_RETRY = new HttpContextToken<boolean>(() => false);
