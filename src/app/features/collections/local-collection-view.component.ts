import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { SignedOutNoticeComponent } from '../../shared/signed-out/signed-out-notice.component';
import { AgentBridgeService } from '../../core/agent/agent-bridge.service';
import { LocalShelfService } from '../../core/agent/local-shelf.service';
import { LocalFolderCollection, LocalFolderEntry } from '../../core/agent/agent.models';
import { CollectionKind, ITEM_TYPE_LABEL, ItemType } from '../../core/models/collection.model';

@Component({
	selector: 'app-local-collection-view',
	standalone: true,
	imports: [DecimalPipe, RouterLink, SignedOutNoticeComponent],
	templateUrl: './local-collection-view.component.html',
	styleUrl: './local-collection-view.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocalCollectionViewComponent {
	private readonly shelf = inject(LocalShelfService);
	readonly bridge = inject(AgentBridgeService);
	readonly auth = inject(AuthService);

	readonly kind = input.required<CollectionKind>();
	/** The agent's id for the file: a hash of its name within its shelf, never a path. */
	readonly id = input.required<string>();

	readonly collection = signal<LocalFolderCollection | null>(null);
	readonly entries = signal<readonly LocalFolderEntry[]>([]);
	readonly loading = signal(false);

	readonly backLink = computed(() => (this.kind() === 'REPERTOIRE' ? '/repertoire' : '/library'));
	readonly title = computed(() => this.collection()?.name ?? 'On this computer');

	readonly missing = computed(() => this.bridge.connected() && !this.loading() && this.collection() === null);

	constructor() {
		effect(() => {
			const kind = this.kind();
			const id = this.id();
			/** Re-read when the agent connects or disconnects. */
			const connected = this.bridge.connected();
			void this.load(kind, id, connected);
		});
	}

	open(entry: LocalFolderEntry): void {
		window.open(`/analysis?local=${encodeURIComponent(entry.id)}`, '_blank', 'noopener');
	}

	label(itemType: string): string {
		return ITEM_TYPE_LABEL[itemType as ItemType] ?? itemType.toLowerCase();
	}

	rowName(entry: LocalFolderEntry): string {
		return entry.shape === 'GAME' ? `${entry.white ?? '?'} — ${entry.black ?? '?'}` : (entry.title ?? 'Untitled');
	}

	private async load(kind: CollectionKind, id: string, connected: boolean): Promise<void> {
		if (!connected) {
			this.collection.set(null);
			this.entries.set([]);
			return;
		}

		this.loading.set(true);
		try {
			const [collection, entries] = await Promise.all([this.shelf.collection(kind, id), this.shelf.entries(id)]);
			this.collection.set(collection);
			this.entries.set(entries);
		} finally {
			this.loading.set(false);
		}
	}
}
