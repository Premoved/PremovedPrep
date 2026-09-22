import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ArchiveNameService {
	private readonly http = inject(HttpClient);

	// Used before the server replies, and if it never does.
	private static readonly FALLBACK = 'Database';

	private readonly _shipped = signal<string | null>(null);

	readonly label = computed(() => {
		const shipped = this._shipped();
		return shipped ? `${shipped} database` : ArchiveNameService.FALLBACK;
	});

	constructor() {
		this.http.get<{ name: string }>(`${environment.apiBaseUrl}/archive`).subscribe({
			next: (archive) => this._shipped.set(archive.name?.trim() || null),
			error: () => this._shipped.set(null),
		});
	}
}
