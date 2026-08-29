import { HttpInterceptorFn } from '@angular/common/http';

const TOKEN_KEY = 'premovedprep.jwt';

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
