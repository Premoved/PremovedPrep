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
import { TimeControlsStore } from '../../../core/services/time-controls.store';
import {
	FIDE_TIME_CONTROLS,
	TIME_CONTROL_CATEGORIES,
	parseTimeControl,
	pgnForName,
	timeControlLabel,
} from '../../../core/chess/time-control';
import { NotificationService } from '../../../core/services/notification.service';
import { CloudStorageService } from '../../../core/services/cloud-storage.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { CollectionIconComponent } from '../../collections/collection-icon.component';
import { MoveTreeStore } from '../state/move-tree.store';
import { FormValidationDirective } from '../../../shared/form-validation/form-validation.directive';

export type GameFilePanel = 'data' | 'location';

export interface SavedEntry {
	readonly itemId: number;
	readonly collectionId: number;
}

type Draft = Record<string, string>;

const RESULTS: readonly string[] = ['1-0', '1/2-1/2', '0-1', '*'];

interface TimeControlChoice {
	readonly name: string;
	/** The PGN TimeControl it stands for; null for a name that cannot be read as one. */
	readonly pgn: string | null;
	// Saved by the user rather than one of FIDE's, which is what the marker in the list means.
	readonly mine: boolean;
}

interface TimeControlGroup {
	readonly label: string;
	readonly options: readonly TimeControlChoice[];
}

const COLOR_LABEL: Readonly<Record<RepertoireColor, string>> = { w: 'White', b: 'Black' };

@Component({
	selector: 'app-game-file-dialog',
	standalone: true,
	imports: [CollectionIconComponent, DatePickerComponent, FormValidationDirective],
	templateUrl: './game-file-dialog.component.html',
	styleUrl: './game-file-dialog.component.scss',
	host: {
		'(document:keydown.escape)': 'closed.emit()',
		'(document:click)': 'closeTimeMenu()',
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
	private readonly timeControlStore = inject(TimeControlsStore);

	readonly panel = input<GameFilePanel>('data');

	readonly openItemId = input<number | null>(null);

	readonly closed = output<void>();
	readonly saved = output<SavedEntry>();

	readonly activePanel = linkedSignal<GameFilePanel>(() => this.panel());

	readonly results = RESULTS;
	readonly icons = COLLECTION_ICONS;
	readonly shelves: readonly CollectionKind[] = ['LIBRARY', 'REPERTOIRE'];
	readonly colors: readonly RepertoireColor[] = ['w', 'b'];

	readonly tcOpen = signal(false);

	// True while a time control the list does not hold is being typed.
	readonly tcOther = signal(false);

	// What is typed in Custom…, kept apart from the game data until it is committed.
	readonly tcTyped = signal('');

	readonly typedPgn = computed(() => parseTimeControl(this.tcTyped()));

	// FIDE's own time controls by category, then the ones the user saved.
	readonly timeControlGroups = computed<readonly TimeControlGroup[]>(() => {
		const groups: TimeControlGroup[] = TIME_CONTROL_CATEGORIES.map((category) => ({
			label: category,
			options: FIDE_TIME_CONTROLS.filter((preset) => preset.category === category).map((preset) => ({
				name: preset.name,
				pgn: preset.pgn,
				mine: false,
			})),
		}));
		const mine = this.timeControlStore.mine().map((name) => ({ name, pgn: pgnForName(name), mine: true }));
		if (mine.length > 0) {
			groups.push({ label: 'Mine', options: mine });
		}
		return groups;
	});

	// The game's own name for its time control, or the reading of its TimeControl.
	readonly timeControlShown = computed(
		() => timeControlLabel(this.draft()['timeControlName'], this.draft()['timeControl']) ?? '',
	);

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

	// The same fields for every type: choosing a type changes what the entry does, not what it holds.
	readonly draft = signal<Draft>(this.draftOf(this.tree.headers()));

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

	// Whether Save overwrites the open entry rather than filing a new one.
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
		this.timeControlStore.refresh();

		// An effect rather than a call in the body: Angular writes an input after construction, so
		// openItemId() read directly here would always be null.
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

					// The constructor loads the Library, so only another shelf needs a reload.
					if (folder.kind !== 'LIBRARY') {
						this.load();
					}
				},
				error: () => {
					// The list stays as it was; this dialog has nowhere to report a failure.
				},
			});
	}

	toggleTimeMenu(event: Event): void {
		// Without this the click reaches the document handler that closes what it just opened.
		event.stopPropagation();
		this.tcOther.set(false);
		this.tcOpen.update((open) => !open);
	}

	closeTimeMenu(): void {
		this.tcOpen.set(false);
	}

	pickTimeControl(choice: TimeControlChoice | null): void {
		this.setField('timeControlName', choice?.name ?? '');
		this.setField('timeControl', choice?.pgn ?? '');
		this.tcOpen.set(false);
	}

	startOtherTimeControl(): void {
		this.tcOpen.set(false);
		this.tcTyped.set(this.timeControlShown());
		this.tcOther.set(true);
	}

	onTypedTimeControl(event: Event): void {
		this.tcTyped.set((event.target as HTMLInputElement).value);
	}

	// Never an error: a name that cannot be read as a time control is kept as written, and the
	// TimeControl tag is left out rather than guessed.
	commitTimeControl(): void {
		if (!this.tcOther()) {
			return;
		}
		const name = this.tcTyped().trim();
		this.tcOther.set(false);
		this.setField('timeControlName', name);
		this.setField('timeControl', name.length > 0 ? (pgnForName(name) ?? '') : '');
		this.timeControlStore.save(name);
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

	// Applies immediately when a destination is already known (an open or already-filed entry);
	// otherwise moves to the location tab, since a new analysis has nowhere to write yet.
	applyData(event: Event): void {
		event.preventDefault();

		if (this.selectedId() !== null) {
			this.write();
			return;
		}

		this.tree.setHeaders(this.headers());
		this.notify.info('Game data updated.');
		this.activePanel.set('location');
	}

	readonly applySaves = computed(() => this.selectedId() !== null && !this.saving());

	readonly applyLabel = computed(() => {
		if (!this.applySaves()) {
			return 'Apply';
		}
		return this.saving() ? 'Saving…' : this.saveLabel();
	});

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
			timeControlName: draft['timeControlName'] ?? '',
			annotator: draft['annotator'] ?? '',
			white: draft['first'] ?? '',
			black: draft['second'] ?? '',
		};

		// The roster first, the form on top: an imported tag not asked about by the form survives.
		const merged: Record<string, string> = { ...this.rosterOf(this.tree.headers()), ...edited };
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(merged)) {
			const trimmed = value.trim();
			if (trimmed.length > 0) {
				headers[key] = trimmed;
			}
		}

		// Carried across by hand: rosterOf only copies string values, so these object-valued tags
		// would otherwise be dropped the first time anyone edited game data.
		const current = this.tree.headers();
		return { ...(headers as GameHeaders), variant: current.variant, extra: current.extra };
	}

	private draftOf(headers: GameHeaders): Draft {
		return {
			first: headers.white ?? '',
			second: headers.black ?? '',
			firstElo: headers.whiteElo ?? '',
			secondElo: headers.blackElo ?? '',
			result: headers.result ?? '*',
			event: headers.event ?? '',
			site: headers.site ?? '',
			date: headers.date ?? '',
			round: headers.round ?? '',
			timeControl: headers.timeControl ?? '',
			timeControlName: headers.timeControlName ?? '',
			annotator: headers.annotator ?? '',
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
		this.write();
	}

	private write(): void {
		const collectionId = this.selectedId();
		if (collectionId === null || this.saving()) {
			return;
		}

		const headers = this.headers();
		this.tree.setHeaders(headers);
		this.saving.set(true);

		const openItemId = this.openItemId();
		const written =
			this.writesBack() && openItemId !== null
				? this.api.updateItem(openItemId, this.pgn(headers), this.itemType())
				: this.api.createItem(collectionId, this.itemType(), this.pgn(headers));

		written.subscribe({
			next: (item) => {
				this.saving.set(false);
				this.cloud.refresh();
				this.saved.emit({ itemId: item.id, collectionId });
			},
			error: (err: Error) => {
				this.saving.set(false);
				// Out of room is reported by the caller, so the dialog stays open.
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
		return fen && fen !== DEFAULT_FEN ? 'STUDY' : 'GAME';
	}
}
