import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BillingRedirect, PlanInterval } from '../models/user.model';

/**
 * Starting and managing the plan, both of which happen on Stripe's own pages. Nothing here holds a
 * card number, a price or a decision: each call answers with a URL, and the browser goes there.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
	private readonly http = inject(HttpClient);
	private readonly baseUrl = `${environment.apiBaseUrl}/billing`;

	checkout(interval: PlanInterval): Observable<BillingRedirect> {
		return this.http.post<BillingRedirect>(
			`${this.baseUrl}/checkout?interval=${interval}`,
			{},
			{ withCredentials: true },
		);
	}

	portal(): Observable<BillingRedirect> {
		return this.http.post<BillingRedirect>(`${this.baseUrl}/portal`, {}, { withCredentials: true });
	}
}
