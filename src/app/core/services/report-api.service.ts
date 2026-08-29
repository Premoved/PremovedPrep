import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AdvancedReport } from '../models/report.model';
import { OpponentScope } from '../models/search.model';

@Injectable({ providedIn: 'root' })
export class ReportApiService {
	private readonly http = inject(HttpClient);
	private readonly baseUrl = `${environment.apiBaseUrl}/report`;

	advanced(scope: OpponentScope) {
		let params = new HttpParams().set('fideId', scope.fideId).set('color', scope.color);
		if (scope.from) {
			params = params.set('from', scope.from);
		}
		if (scope.to) {
			params = params.set('to', scope.to);
		}
		return this.http.get<AdvancedReport>(`${this.baseUrl}/advanced`, { params });
	}
}
