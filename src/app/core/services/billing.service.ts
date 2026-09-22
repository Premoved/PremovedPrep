import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SubscriptionView } from '../models/user.model';

// The plan is bought in the Desktop App; this site only cancels, so stopping payment never needs it.
@Injectable({ providedIn: 'root' })
export class BillingService {
	private readonly http = inject(HttpClient);
	private readonly baseUrl = `${environment.apiBaseUrl}/billing`;

	// Returns the plan after cancellation: still active until its end date.
	cancel(): Observable<SubscriptionView> {
		return this.http.post<SubscriptionView>(`${this.baseUrl}/cancel`, {}, { withCredentials: true });
	}
}
