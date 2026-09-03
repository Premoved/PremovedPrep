import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	input,
	linkedSignal,
	output,
	signal,
	untracked,
} from '@angular/core';
import { map, switchMap } from 'rxjs';
import { DEFAULT_FEN } from '../../../core/chess/fen.util';
import { GameHeaders } from '../../../core/chess/game-headers';
import { composePgnFile } from '../../../core/chess/pgn-file';
import { PgnSerializerService } from '../../../core/chess/pgn-serializer.service';
import {
	COLLECTION_ICONS,
	CollectionKind,
	CollectionSummary,
	ITEM_TYPES_BY_KIND,
	ITEM_TYPE_LABEL,
	ItemType,
	RepertoireColor,
} from '../../../core/models/collection.model';
import { AuthService } from '../../../core/services/auth.service';
import { CollectionApiService } from '../../../core/services/collection-api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CloudStorageService } from '../../../core/services/cloud-storage.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { CollectionIconComponent } from '../../collections/collection-icon.component';
import { MoveTreeStore } from '../state/move-tree.store';

export type GameFilePanel = 'data' | 'location';

export interface SavedEntry {
	readonly itemId: number;
	readonly collectionId: number;
}

type Draft = Record<string, string>;

const RESULTS: readonly string[] = ['1-0', '1/2-1/2', '0-1', '*'];

/** Types identified by a title and an author rather than by two players. */
const DOCUMENT_TYPES: readonly ItemType[] = ['ANALYSIS', 'STUDY', 'MAIN_LINE'];

const COLOR_LABEL: Readonly<Record<RepertoireColor, string>> = { w: 'White', b: 'Black' };

/** The board's game file: what the game is, and where it goes. */
@Component({
	selector: 'app-game-file-dialog',
	standalone: true,
	imports: [CollectionIconComponent, DatePickerComponent],
	templateUrl: './game-file-dialog.component.html',
	styleUrl: './game-file-dialog.component.scss',
	host: {
		'(document:keydown.escape)': 'closed.emit()',
	},
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameFileDialogComponent {
	private readonly api = inject(CollectionApiService);
	private readonly auth = inject(AuthService);
	private readonly notify = inject(NotificationService);
	private readonly cloud = inject(CloudStorageService);
	private readonly serializer = inject(PgnSerializerService);
	private readonly tree = inject(MoveTreeStore);

	readonly panel = input<GameFilePanel>('data');

	readonly openItemId = input<number | null>(null);

	readonly closed = output<void>();
	readonly saved = output<SavedEntry>();

	readonly activePanel = linkedSignal<GameFilePanel>(() => this.panel());

	readonly results = RESULTS;
	readonly icons = COLLECTION_ICONS;
	readonly shelves: readonly CollectionKind[] = ['LIBRARY', 'REPERTOIRE'];
	readonly colors: readonly RepertoireColor[] = ['w', 'b'];

	readonly draft = signal<Draft>(this.draftOf(this.tree.headers(), false));

	readonly kind = signal<CollectionKind>('LIBRARY');
	readonly color = signal<RepertoireColor>('w');

	private readonly homeCollectionId = signal<number | null>(null);

	readonly folders = signal<readonly CollectionSummary[]>([]);
	readonly loading = signal(false);
	readonly selectedId = signal<number | null>(null);
	readonly saving = signal(false);

	readonly creatingFolder = signal(false);
	readonly newFolderName = signal('');
	readonly newFolderIcon = signal<string>('folder');

	readonly itemType = signal<ItemType>(this.defaultTypeFor('LIBRARY'));
	readonly types = computed(() => ITEM_TYPES_BY_KIND[this.kind()]);

	readonly isDocument = computed(() => DOCUMENT_TYPES.includes(this.itemType()));

	readonly firstLabel = computed(() => (this.isDocument() ? 'Title' : 'White'));
	readonly secondLabel = computed(() => (this.isDocument() ? 'Author' : 'Black'));

	readonly path = computed(() => {
		const parts: string[] = [this.kind() === 'LIBRARY' ? 'library' : 'repertoire'];
		if (this.kind() === 'REPERTOIRE') {
			parts.push(COLOR_LABEL[this.color()].toLowerCase());
		}
		const folder = this.folders().find((item) => item.id === this.selectedId());
		if (folder) {
			parts.push(folder.name);
		}
		return parts;
	});

	readonly userName = computed(() => this.auth.currentUser()?.username ?? 'you');
	readonly canSave = computed(() => this.selectedId() !== null && !this.saving());

	/** Whether Save overwrites the open entry rather than filing a new one. */
	readonly writesBack = computed(
		() => this.openItemId() !== null && this.selectedId() !== null && this.selectedId() === this.homeCollectionId(),
	);

	readonly saveLabel = computed(() => {
		if (this.saving()) {
			return 'Saving…';
		}
		return this.openItemId() !== null && !this.writesBack() ? 'Save a copy' : 'Save';
	});

	constructor() {
		this.load();

		/**
		 * An effect rather than a call in the body: Angular writes an input after the component is
		 * constructed, so openItemId() read here was null every time. That is why Save always filed a
		 * copy instead of writing back, and why the type and the fields never came back as the open
		 * entry's own.
		 */
		let located: number | null = null;
		effect(() => {
			const itemId = this.openItemId();
			if (itemId === null || itemId === located) {
				return;
			}
			located = itemId;
			untracked(() => this.locateOpenEntry(itemId));
		});
	}

	private locateOpenEntry(itemId: number): void {
		this.api
			.getItem(itemId)
			.pipe(
				switchMap((detail) =>
					this.api.get(detail.collectionId).pipe(map((folder) => ({ folder, itemType: detail.itemType }))),
				),
			)
			.subscribe({
				next: ({ folder, itemType }) => {
					this.homeCollectionId.set(folder.id);
					this.kind.set(folder.kind);
					if (folder.color !== null) {
						this.color.set(folder.color);
					}
					this.selectedId.set(folder.id);

					const type = ITEM_TYPES_BY_KIND[folder.kind].includes(itemType) ? itemType : this.defaultTypeFor(folder.kind);
					this.itemType.set(type);

					/** Re-seeded now that the type is known: a document keeps its title and author in
					 * Event and Annotator, so those are the tags its first two fields have to show. */
					this.draft.set(this.draftOf(this.tree.headers(), DOCUMENT_TYPES.includes(type)));

					/** The constructor loads the Library, so only another shelf needs a reload. */
					if (folder.kind !== 'LIBRARY') {
						this.load();
					}
				},
				error: () => {
					// The list stays as it was; this dialog has nowhere to report a failure.
				},
			});
	}

	show(panel: GameFilePanel): void {
		this.activePanel.set(panel);
	}

	labelFor(type: ItemType): string {
		return ITEM_TYPE_LABEL[type];
	}

	shelfLabel(kind: CollectionKind): string {
		return kind === 'LIBRARY' ? 'Library' : 'Repertoire';
	}

	colorLabel(color: RepertoireColor): string {
		return COLOR_LABEL[color];
	}

	valueOf(key: string): string {
		return this.draft()[key] ?? '';
	}

	onField(key: string, event: Event): void {
		const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
		this.setField(key, value);
	}

	setField(key: string, value: string): void {
		this.draft.update((current) => ({ ...current, [key]: value }));
	}

	chooseType(type: ItemType): void {
		this.itemType.set(type);
	}

	applyData(event: Event): void {
		event.preventDefault();
		this.tree.setHeaders(this.headers());
		this.notify.info('Game data updated.');
		this.activePanel.set('location');
	}

	private headers(): GameHeaders {
		const draft = this.draft();

		const edited: Draft = {
			whiteElo: draft['firstElo'] ?? '',
			blackElo: draft['secondElo'] ?? '',
			result: draft['result'] ?? '',
			event: draft['event'] ?? '',
			site: draft['site'] ?? '',
			date: draft['date'] ?? '',
			round: draft['round'] ?? '',
			timeControl: draft['timeControl'] ?? '',
			annotator: draft['annotator'] ?? '',
			white: draft['first'] ?? '',
			black: draft['second'] ?? '',
		};

		if (this.isDocument()) {
			edited['event'] = draft['event'] || draft['first'] || '';
			edited['annotator'] = draft['annotator'] || draft['second'] || '';
			edited['white'] = '';
			edited['black'] = '';
		}

		/**
		 * The roster first, the form on top. Termination is not a field any more, and this is why it
		 * survives: an imported game keeps the tag it arrived with instead of being blanked by a form
		 * that no longer asks about it.
		 */
		const merged: Record<string, string> = { ...this.rosterOf(this.tree.headers()), ...edited };
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(merged)) {
			const trimmed = value.trim();
			if (trimmed.length > 0) {
				headers[key] = trimmed;
			}
		}
		return headers as GameHeaders;
	}

	/**
	 * `document` decides where the first two fields come from. A study or an analysis keeps its title
	 * in Event and its author in Annotator - the same tags headers() writes them back to - so reading
	 * them from white and black would show two empty boxes over a named document.
	 */
	private draftOf(headers: GameHeaders, document: boolean): Draft {
		return {
			first: (document ? headers.event : headers.white) ?? '',
			second: (document ? headers.annotator : headers.black) ?? '',
			firstElo: headers.whiteElo ?? '',
			secondElo: headers.blackElo ?? '',
			result: headers.result ?? '*',
			event: document ? '' : (headers.event ?? ''),
			site: headers.site ?? '',
			date: headers.date ?? '',
			round: headers.round ?? '',
			timeControl: headers.timeControl ?? '',
			annotator: document ? '' : (headers.annotator ?? ''),
		};
	}

	private rosterOf(headers: GameHeaders): Record<string, string> {
		const roster: Record<string, string> = {};
		for (const [key, value] of Object.entries(headers)) {
			if (typeof value === 'string') {
				roster[key] = value;
			}
		}
		return roster;
	}

	selectShelf(kind: CollectionKind): void {
		if (this.kind() === kind) {
			return;
		}
		this.kind.set(kind);
		this.itemType.set(this.defaultTypeFor(kind));
		this.reload();
	}

	selectColor(color: RepertoireColor): void {
		if (this.color() === color) {
			return;
		}
		this.color.set(color);
		this.reload();
	}

	private reload(): void {
		this.selectedId.set(null);
		this.creatingFolder.set(false);
		this.load();
	}

	private load(): void {
		const kind = this.kind();
		this.loading.set(true);

		this.api.list(kind, kind === 'REPERTOIRE' ? this.color() : null).subscribe({
			next: (folders) => {
				this.folders.set(folders);
				this.loading.set(false);
			},
			error: (err: Error) => {
				this.loading.set(false);
				this.notify.error(err.message);
			},
		});
	}

	select(folder: CollectionSummary): void {
		this.selectedId.set(folder.id);
	}

	startFolder(): void {
		this.creatingFolder.set(true);
		this.newFolderName.set('');
		this.newFolderIcon.set('folder');
	}

	cancelFolder(): void {
		this.creatingFolder.set(false);
	}

	onNewFolderName(event: Event): void {
		this.newFolderName.set((event.target as HTMLInputElement).value);
	}

	chooseIcon(icon: string): void {
		this.newFolderIcon.set(icon);
	}

	createFolder(event: Event): void {
		event.preventDefault();

		const kind = this.kind();
		const name = this.newFolderName().trim();
		if (name.length === 0) {
			return;
		}

		this.api.create(kind, name, this.newFolderIcon(), kind === 'REPERTOIRE' ? this.color() : null).subscribe({
			next: (folder) => {
				this.creatingFolder.set(false);
				this.folders.update((list) => [...list, folder]);
				this.selectedId.set(folder.id);
			},
			error: (err: Error) => this.notify.error(err.message),
		});
	}

	save(event: Event): void {
		event.preventDefault();

		const collectionId = this.selectedId();
		if (collectionId === null || this.saving()) {
			return;
		}

		const headers = this.headers();
		this.tree.setHeaders(headers);
		this.saving.set(true);

		const draft = this.draft();
		const title = this.isDocument() ? draft['first']?.trim() || headers.event : undefined;
		const author = this.isDocument() ? draft['second']?.trim() || undefined : undefined;

		const openItemId = this.openItemId();
		const written =
			this.writesBack() && openItemId !== null
				? this.api.updateItem(openItemId, this.pgn(headers), title || undefined, author, this.itemType())
				: this.api.createItem(collectionId, this.itemType(), this.pgn(headers), title || undefined, author);

		written.subscribe({
			next: (item) => {
				this.saving.set(false);
				this.cloud.refresh();
				this.saved.emit({ itemId: item.id, collectionId });
			},
			error: (err: Error) => {
				this.saving.set(false);
				/** Out of room is reported by the caller, so the dialog stays open. */
				if (this.cloud.reportFull(err)) {
					this.closed.emit();
					return;
				}
				this.notify.error(err.message);
			},
		});
	}

	private pgn(headers: GameHeaders): string {
		const root = this.tree.root();
		return composePgnFile({
			headers,
			startFen: root?.fen ?? DEFAULT_FEN,
			movetext: this.serializer.movetext(root),
			annotator: headers.annotator ?? null,
		});
	}

	private defaultTypeFor(kind: CollectionKind): ItemType {
		if (kind === 'REPERTOIRE') {
			return 'MAIN_LINE';
		}
		const fen = this.tree.root()?.fen;
		return fen && fen !== DEFAULT_FEN ? 'STUDY' : 'ANALYSIS';
	}
}
