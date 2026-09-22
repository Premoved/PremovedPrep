import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppStage, DesktopAppAccess } from '../models/user.model';

// Both questions are the server's to answer: a check the client made on itself, with public
// source, would be a check with a patch next to it.
@Injectable({ providedIn: 'root' })
export class DesktopAppApiService {
	private readonly http = inject(HttpClient);
	private readonly baseUrl = `${environment.apiBaseUrl}/app`;

	// Open to everyone, so the page says the same thing before anybody has signed in.
	stage(): Observable<{ stage: AppStage }> {
		return this.http.get<{ stage: AppStage }>(`${this.baseUrl}/stage`);
	}

	access(): Observable<DesktopAppAccess> {
		return this.http.get<DesktopAppAccess>(`${this.baseUrl}/access`, { withCredentials: true });
	}
}
