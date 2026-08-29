import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AgentSelectionStore } from '../agent/agent-selection.store';

/** The display name of the database the board is currently reading. */
@Injectable({ providedIn: 'root' })
export class ArchiveNameService {
	private readonly http = inject(HttpClient);
	private readonly selection = inject(AgentSelectionStore);

	/** Used before the server replies, and if it never does. */
	private static readonly FALLBACK = 'Database';

	private readonly _shipped = signal<string | null>(null);

	readonly label = computed(() => {
		const local = this.selection.database();
		if (local) {
			return local.name;
		}
		const shipped = this._shipped();
		return shipped ? `${shipped} database` : ArchiveNameService.FALLBACK;
	});

	readonly local = computed(() => this.selection.database() !== null);

	constructor() {
		this.http.get<{ name: string }>(`${environment.apiBaseUrl}/archive`).subscribe({
			next: (archive) => this._shipped.set(archive.name?.trim() || null),
			error: () => this._shipped.set(null),
		});
	}
}
