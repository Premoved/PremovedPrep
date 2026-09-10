import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { SKIP_SESSION_RETRY, readAccessToken } from '../auth/access-token';
import { SessionService } from '../auth/session.service';

/**
 * Attaches the access token, and answers the one failure it is responsible for.
 *
 * It sits inside errorInterceptor rather than outside it, so what arrives here is the raw
 * HttpErrorResponse: a 401 recovered by a refresh never becomes an error the UI has to describe,
 * and one that is not recovered is translated on the way out exactly as before.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
	const session = inject(SessionService);

	return next(withToken(req, readAccessToken())).pipe(
		catchError((error: unknown) => {
			const recoverable =
				error instanceof HttpErrorResponse && error.status === 401 && !req.context.get(SKIP_SESSION_RETRY);
			if (!recoverable) {
				return throwError(() => error);
			}

			/**
			 * The token has lapsed, or the session was ended somewhere else. One refresh answers both,
			 * and it is shared: a page firing six calls at once causes one refresh, not six.
			 */
			return session
				.renew()
				.pipe(switchMap((token) => (token === null ? throwError(() => error) : next(withToken(req, token)))));
		}),
	);
};

function withToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
	return token === null ? req : req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
