import { Injectable, inject } from '@angular/core';
import { AgentBridgeService } from './agent-bridge.service';
import { CollectionKind, RepertoireColor } from '../models/collection.model';
import { LocalFolderCollection, LocalFolderEntry, LocalFolderEntryDetail } from './agent.models';

/** Exposes the .pgn files in the agent's linked folder as collections. */
@Injectable({ providedIn: 'root' })
export class LocalShelfService {
	private readonly bridge = inject(AgentBridgeService);

	available(): boolean {
		return this.bridge.connected();
	}

	async shelf(kind: CollectionKind, color: RepertoireColor | null): Promise<readonly LocalFolderCollection[]> {
		if (!this.available()) {
			return [];
		}
		try {
			return await this.bridge.request<LocalFolderCollection[]>('folder.shelf', {
				kind,
				color: kind === 'REPERTOIRE' ? (color ?? 'w') : null,
			});
		} catch {
			return [];
		}
	}

	async collection(kind: CollectionKind, id: string): Promise<LocalFolderCollection | null> {
		const shelves: (RepertoireColor | null)[] = kind === 'REPERTOIRE' ? ['w', 'b'] : [null];

		for (const color of shelves) {
			const found = (await this.shelf(kind, color)).find((collection) => collection.id === id);
			if (found) {
				return found;
			}
		}
		return null;
	}

	async entries(collectionId: string): Promise<readonly LocalFolderEntry[]> {
		if (!this.available()) {
			return [];
		}
		try {
			return await this.bridge.request<LocalFolderEntry[]>('folder.entries', { collectionId });
		} catch {
			return [];
		}
	}

	async entry(id: string): Promise<LocalFolderEntryDetail> {
		return this.bridge.request<LocalFolderEntryDetail>('folder.entry', { id });
	}
}
