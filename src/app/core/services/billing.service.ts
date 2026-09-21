import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SubscriptionView } from '../models/user.model';

/**
 * The website's one billing action: cancelling the plan.
 *
 * The Premoved Plan is bought in the Desktop App, and nothing on this site starts or changes one.
 * Cancelling is the exception, so that stopping a payment never needs the application installed:
 * the plan stops renewing and runs until the end of the period already paid for.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
	private readonly http = inject(HttpClient);
	private readonly baseUrl = `${environment.apiBaseUrl}/billing`;

	/** Answers with the plan as it now stands - still active, and ending on the date it says. */
	cancel(): Observable<SubscriptionView> {
		return this.http.post<SubscriptionView>(`${this.baseUrl}/cancel`, {}, { withCredentials: true });
	}
}
