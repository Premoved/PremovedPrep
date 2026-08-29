import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { saveBlob } from '../../core/browser/download';
import { ClipboardStore } from '../../core/services/clipboard.store';
import { CollectionApiService } from '../../core/services/collection-api.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { NotificationService } from '../../core/services/notification.service';
import {
	COLLECTION_ICONS,
	CollectionIcon,
	CollectionKind,
	CollectionSummary,
	RepertoireColor,
} from '../../core/models/collection.model';
import { AuthService } from '../../core/services/auth.service';
import { SignedOutNoticeComponent } from '../../shared/signed-out/signed-out-notice.component';
import { AgentBridgeService } from '../../core/agent/agent-bridge.service';
import { LocalShelfService } from '../../core/agent/local-shelf.service';
import { LocalFolderCollection } from '../../core/agent/agent.models';
import { CollectionIconComponent } from './collection-icon.component';
import { BishopLogoComponent } from '../../shared/logo/bishop-logo.component';
import { RookLogoComponent } from '../../shared/logo/rook-logo.component';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { fitOnScreen } from '../../core/browser/menu-placement';

interface Editor {
	readonly editing: CollectionSummary | null;
	readonly name: string;
	readonly icon: CollectionIcon;
}

interface Highlight {
	readonly pre: string;
	readonly match: string;
	readonly post: string;
}

interface CollectionCard {
	readonly collection: CollectionSummary;
	readonly highlight: Highlight;
}

type SortMode = 'manual' | 'alpha-asc' | 'alpha-desc';

type ShelfSource = 'all' | 'cloud' | 'local';

interface LocalCard {
	readonly collection: LocalFolderCollection;
	readonly highlight: Highlight;
}

/** The grid of collections. Serves both /library and /repertoire. */
const MENU_FOOTPRINT = { width: 208, height: 132 };

@Component({
	selector: 'app-collections-page',
	standalone: true,
	imports: [
		CollectionIconComponent,
		TooltipDirective,
		SignedOutNoticeComponent,
		BishopLogoComponent,
		RookLogoComponent,
	],
	templateUrl: './collections-page.component.html',
	styleUrl: './collections-page.component.scss',
	host: {
		'(document:click)': 'onDocumentClick($event)',
		'(document:keydown.escape)': 'onEscape()',
		/** Ctrl+A / Ctrl+C / Ctrl+X / Ctrl+V / Delete, bound on the document. */
		'(document:keydown)': 'onShortcut($event)',
	},
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionsPageComponent {
	private readonly api = inject(CollectionApiService);
	private readonly router = inject(Router);
	private readonly notify = inject(NotificationService);
	private readonly confirmDialog = inject(ConfirmService);
	private readonly clipboard = inject(ClipboardStore);
	readonly auth = inject(AuthService);
	private readonly localShelf = inject(LocalShelfService);
	readonly bridge = inject(AgentBridgeService);

	readonly kind = input.required<CollectionKind>();
	readonly title = input('Collections');
	readonly description = input('');

	readonly icons = COLLECTION_ICONS;

	readonly color = signal<RepertoireColor>('w');
	readonly collections = signal<readonly CollectionSummary[]>([]);
	readonly loading = signal(false);
	readonly error = signal<string | null>(null);

	readonly selectedIds = signal<ReadonlySet<number>>(new Set());

	readonly selectionCount = computed(() => this.selectedIds().size);
	readonly hasSelection = computed(() => this.selectionCount() > 0);

	readonly countSuffix = computed(() => (this.selectionCount() > 1 ? ` (${this.selectionCount()})` : ''));

	readonly pasteSuffix = computed(() => {
		const size = this.pending()?.ids.length ?? 0;
		return size > 1 ? ` (${size})` : '';
	});

	readonly pending = computed(() => this.clipboard.contents());
	readonly canPaste = computed(() => this.pending()?.scope === 'COLLECTIONS');

	readonly menu = signal<{ x: number; y: number; collection: CollectionSummary } | null>(null);
	readonly editor = signal<Editor | null>(null);
	readonly saving = signal(false);

	readonly isRepertoire = computed(() => this.kind() === 'REPERTOIRE');
	readonly isEmpty = computed(
		() => !this.loading() && this.collections().length === 0 && this.localCollections().length === 0,
	);

	readonly sortMode = signal<SortMode>('manual');
	readonly search = signal('');

	readonly source = signal<ShelfSource>('all');
	readonly localCollections = signal<readonly LocalFolderCollection[]>([]);
	readonly localLoading = signal(false);

	readonly canFilterSource = computed(() => this.bridge.connected());

	readonly localFolderPath = computed(() => this.bridge.backup()?.root ?? null);

	readonly showCloud = computed(() => this.auth.isLoggedIn() && (!this.canFilterSource() || this.source() !== 'local'));
	readonly showLocal = computed(() => this.auth.isLoggedIn() && this.canFilterSource() && this.source() !== 'cloud');

	readonly localCards = computed<readonly LocalCard[]>(() => {
		const query = this.search().trim().toLowerCase();
		let list = this.localCollections();

		if (query) {
			list = list.filter((collection) => collection.name.toLowerCase().includes(query));
		}

		const mode = this.sortMode();
		if (mode !== 'manual') {
			const direction = mode === 'alpha-asc' ? 1 : -1;
			list = [...list].sort((a, b) => direction * a.name.localeCompare(b.name));
		}

		return list.map((collection) => ({ collection, highlight: highlightMatch(collection.name, query) }));
	});

	/** Dragging only works in the server's order, unsorted and unfiltered. */
	readonly canReorder = computed(() => this.sortMode() === 'manual' && this.search().trim().length === 0);

	readonly cards = computed<readonly CollectionCard[]>(() => {
		const query = this.search().trim().toLowerCase();
		let list = this.collections();

		if (query) {
			list = list.filter((collection) => collection.name.toLowerCase().includes(query));
		}

		const mode = this.sortMode();
		if (mode !== 'manual') {
			const direction = mode === 'alpha-asc' ? 1 : -1;
			list = [...list].sort((a, b) => direction * a.name.localeCompare(b.name));
		}

		return list.map((collection) => ({ collection, highlight: highlightMatch(collection.name, query) }));
	});

	readonly searchEmpty = computed(
		() =>
			!this.loading() &&
			this.collections().length + this.localCollections().length > 0 &&
			this.cards().length + this.localCards().length === 0,
	);

	readonly dragIndex = signal<number | null>(null);
	readonly dropIndex = signal<number | null>(null);

	private readonly requestColor = computed<RepertoireColor | null>(() => (this.isRepertoire() ? this.color() : null));

	constructor() {
		effect(() => {
			const kind = this.kind();
			const color = this.requestColor();
			if (!this.auth.isLoggedIn()) {
				this.collections.set([]);
				return;
			}
			this.load(kind, color);
		});

		effect(() => {
			const kind = this.kind();
			const color = this.color();
			const connected = this.bridge.connected();
			void this.loadLocal(kind, kind === 'REPERTOIRE' ? color : null, connected);
		});
	}

	private load(kind: CollectionKind, color: RepertoireColor | null): void {
		this.loading.set(true);
		this.error.set(null);

		this.api.list(kind, color).subscribe({
			next: (collections) => {
				this.collections.set(collections);
				this.loading.set(false);
			},
			error: (err: Error) => {
				this.error.set(err.message);
				this.loading.set(false);
			},
		});
	}

	private async loadLocal(kind: CollectionKind, color: RepertoireColor | null, connected: boolean): Promise<void> {
		if (!connected) {
			this.localCollections.set([]);
			return;
		}

		this.localLoading.set(true);
		try {
			this.localCollections.set(await this.localShelf.shelf(kind, color));
		} finally {
			this.localLoading.set(false);
		}
	}

	private reload(): void {
		this.load(this.kind(), this.requestColor());
	}

	setSource(source: ShelfSource): void {
		this.source.set(source);
	}

	openLocal(collection: LocalFolderCollection): void {
		void this.router.navigate([this.basePath(), 'local', collection.id]);
	}

	size(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB'];
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		return `${value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
	}

	switchColor(color: RepertoireColor): void {
		this.color.set(color);
	}

	open(collection: CollectionSummary): void {
		this.router.navigate([this.basePath(), 'c', collection.id]);
	}

	onCardClick(event: MouseEvent, collection: CollectionSummary): void {
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			this.toggle(collection.id);
			return;
		}
		this.open(collection);
	}

	isSelected(id: number): boolean {
		return this.selectedIds().has(id);
	}

	private toggle(id: number): void {
		this.clipboard.clear();
		this.selectedIds.update((current) => {
			const next = new Set(current);
			if (!next.delete(id)) {
				next.add(id);
			}
			return next;
		});
	}

	selectAll(): void {
		this.clipboard.clear();
		this.selectedIds.set(new Set(this.cards().map((card) => card.collection.id)));
	}

	clearSelection(): void {
		this.selectedIds.set(new Set());
	}

	private selectionInOrder(): number[] {
		const chosen = this.selectedIds();
		return this.cards()
			.map((card) => card.collection.id)
			.filter((id) => chosen.has(id));
	}

	onShortcut(event: KeyboardEvent): void {
		if (this.editor() || isTyping(event.target)) {
			return;
		}
		const modifier = event.ctrlKey || event.metaKey;

		if (modifier && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			this.selectAll();
			return;
		}
		if (modifier && event.key.toLowerCase() === 'c') {
			this.copySelection(true);
			return;
		}
		if (modifier && event.key.toLowerCase() === 'x') {
			this.copySelection(false);
			return;
		}
		if (modifier && event.key.toLowerCase() === 'v') {
			this.paste();
			return;
		}
		if ((event.key === 'Delete' || event.key === 'Backspace') && this.hasSelection()) {
			event.preventDefault();
			void this.removeSelected();
		}
	}

	copySelection(copy: boolean): void {
		const ids = this.selectionInOrder();
		if (ids.length === 0) {
			return;
		}
		this.clipboard.put('COLLECTIONS', ids, copy, `${ids.length}`);
		this.notify.info(`${ids.length === 1 ? '1 collection' : ids.length + ' collections'} ${copy ? 'copied' : 'cut'}.`);
	}

	paste(): void {
		const contents = this.clipboard.take('COLLECTIONS');
		if (!contents) {
			return;
		}

		this.api.transferCollections(this.kind(), this.requestColor(), contents.ids, contents.copy).subscribe({
			next: (moved) => {
				this.clipboard.consumed();
				this.selectedIds.set(new Set(moved.map((collection) => collection.id)));
				this.reload();
			},
			error: (err: Error) => this.notify.error(err.message),
		});
	}

	exportShelf(): void {
		const ids = this.selectionInOrder();
		this.api.exportArchive(this.kind(), this.requestColor(), ids).subscribe({
			next: (blob) => saveBlob(blob, this.archiveName(ids.length)),
			error: (err: Error) => this.notify.error(err.message),
		});
	}

	private archiveName(selected: number): string {
		const shelf = this.isRepertoire() ? `repertoire-${this.color()}` : 'library';
		return selected > 0 ? `${shelf}-selection.zip` : `${shelf}.zip`;
	}

	async removeSelected(): Promise<void> {
		const ids = this.selectionInOrder();
		if (ids.length === 0) {
			return;
		}
		const chosen = this.collections().filter((collection) => ids.includes(collection.id));
		const games = chosen.reduce((total, collection) => total + collection.itemCount, 0);
		const what = chosen.length === 1 ? `"${chosen[0].name}"` : `${chosen.length} collections`;

		const confirmed = await this.confirmDialog.ask(
			`Delete ${what} and ${games === 1 ? 'its 1 game' : `their ${games} games`}? This cannot be undone.`,
			{ confirmLabel: 'Delete', danger: true },
		);
		if (!confirmed) {
			return;
		}

		let remaining = ids.length;
		for (const id of ids) {
			this.api.remove(id).subscribe({
				next: () => {
					if (--remaining === 0) {
						this.clearSelection();
						this.reload();
					}
				},
				error: (err: Error) => {
					this.notify.error(err.message);
					if (--remaining === 0) {
						this.clearSelection();
						this.reload();
					}
				},
			});
		}
	}

	private basePath(): string {
		return this.isRepertoire() ? '/repertoire' : '/library';
	}

	startCreate(): void {
		this.closeMenu();
		this.editor.set({ editing: null, name: '', icon: 'folder' });
	}

	startEdit(collection: CollectionSummary): void {
		this.closeMenu();
		this.editor.set({
			editing: collection,
			name: collection.name,
			/** The stored icon key may be one this build does not know. */
			icon: (COLLECTION_ICONS as readonly string[]).includes(collection.icon)
				? (collection.icon as CollectionIcon)
				: 'folder',
		});
	}

	onEditorName(event: Event): void {
		const name = (event.target as HTMLInputElement).value;
		this.editor.update((current) => (current ? { ...current, name } : current));
	}

	chooseIcon(icon: CollectionIcon): void {
		this.editor.update((current) => (current ? { ...current, icon } : current));
	}

	closeEditor(): void {
		this.editor.set(null);
	}

	saveEditor(event: Event): void {
		event.preventDefault();

		const editor = this.editor();
		if (!editor || editor.name.trim().length === 0 || this.saving()) {
			return;
		}

		this.saving.set(true);
		const name = editor.name.trim();

		const request = editor.editing
			? this.api.update(editor.editing.id, { name, icon: editor.icon })
			: this.api.create(this.kind(), name, editor.icon, this.requestColor());

		request.subscribe({
			next: () => {
				this.saving.set(false);
				this.editor.set(null);
				this.reload();
			},
			error: (err: Error) => {
				this.saving.set(false);
				this.notify.error(err.message);
			},
		});
	}

	openMenu(event: MouseEvent, collection: CollectionSummary): void {
		event.preventDefault();
		const at = fitOnScreen(event.clientX, event.clientY, MENU_FOOTPRINT);
		this.menu.set({ x: at.x, y: at.y, collection });
	}

	closeMenu(): void {
		this.menu.set(null);
	}

	onDocumentClick(event: MouseEvent): void {
		this.closeMenu();

		const target = event.target as HTMLElement | null;
		if (!target || target.closest('.card, .toolbar, .context-menu, .modal')) {
			return;
		}
		this.clearSelection();
	}

	onEscape(): void {
		if (this.menu()) {
			this.closeMenu();
			return;
		}
		if (this.editor()) {
			this.closeEditor();
			return;
		}
		this.clearSelection();
	}

	async remove(): Promise<void> {
		const menu = this.menu();
		if (!menu) {
			return;
		}
		this.closeMenu();

		const { collection } = menu;
		const contents = collection.itemCount === 1 ? '1 game' : `${collection.itemCount} games`;
		const confirmed = await this.confirmDialog.ask(
			`Delete "${collection.name}" and its ${contents}? This cannot be undone.`,
			{
				confirmLabel: 'Delete',
				danger: true,
			},
		);
		if (!confirmed) {
			return;
		}

		this.api.remove(collection.id).subscribe({
			next: () => this.reload(),
			error: (err: Error) => this.notify.error(err.message),
		});
	}

	onSearch(event: Event): void {
		this.search.set((event.target as HTMLInputElement).value);
	}

	useManualOrder(): void {
		this.sortMode.set('manual');
	}

	toggleAlphabetical(): void {
		this.sortMode.update((mode) => (mode === 'alpha-asc' ? 'alpha-desc' : 'alpha-asc'));
	}

	onCardDragStart(event: DragEvent, index: number): void {
		if (!this.canReorder()) {
			event.preventDefault();
			return;
		}
		this.dragIndex.set(index);
		const card = this.cards()[index];
		event.dataTransfer?.setData('text/plain', String(card?.collection.id ?? ''));
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	onCardDragOver(event: DragEvent, index: number): void {
		if (this.dragIndex() === null) {
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}

		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const gap = event.clientX < box.left + box.width / 2 ? index : index + 1;
		this.dropIndex.set(gap);
	}

	onCardDragEnd(): void {
		this.dragIndex.set(null);
		this.dropIndex.set(null);
	}

	onCardDrop(event: DragEvent): void {
		event.preventDefault();
		const from = this.dragIndex();
		const to = this.dropIndex();
		this.onCardDragEnd();

		if (from !== null && to !== null) {
			this.moveCard(from, to);
		}
	}

	private moveCard(from: number, to: number): void {
		const current = this.collections();
		const moved = current[from];
		if (!moved) {
			return;
		}

		/** `to` is a gap, so lifting the card out shifts everything after it up by one. */
		const target = to > from ? to - 1 : to;
		if (target === from) {
			return;
		}

		const next = [...current];
		next.splice(from, 1);
		next.splice(target, 0, moved);

		const renumbered = next.map((collection, index) => ({ ...collection, sortOrder: index }));
		this.collections.set(renumbered);

		const changed = renumbered.filter((collection) => {
			const before = current.find((c) => c.id === collection.id);
			return before === undefined || before.sortOrder !== collection.sortOrder;
		});

		for (const collection of changed) {
			this.api.update(collection.id, { sortOrder: collection.sortOrder }).subscribe({
				error: (err: Error) => {
					this.notify.error(err.message);
					this.reload();
				},
			});
		}
	}
}

function highlightMatch(name: string, query: string): Highlight {
	if (!query) {
		return { pre: name, match: '', post: '' };
	}
	const index = name.toLowerCase().indexOf(query);
	if (index === -1) {
		return { pre: name, match: '', post: '' };
	}
	return {
		pre: name.slice(0, index),
		match: name.slice(index, index + query.length),
		post: name.slice(index + query.length),
	};
}

function isTyping(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;
	if (!element) {
		return false;
	}
	const tag = element.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}
