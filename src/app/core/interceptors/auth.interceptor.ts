import { HttpInterceptorFn } from '@angular/common/http';

/** Exported so AuthService can tell this key apart from every other one in a `storage` event. */
export const TOKEN_STORAGE_KEY = 'premovedprep.jwt';
const TOKEN_KEY = TOKEN_STORAGE_KEY;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
	const token = localStorage.getItem(TOKEN_KEY);
	if (!token) {
		return next(req);
	}
	return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};

export function storeToken(token: string): void {
	localStorage.setItem(TOKEN_KEY, token);
}

export function readToken(): string | null {
	return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
	localStorage.removeItem(TOKEN_KEY);
}
