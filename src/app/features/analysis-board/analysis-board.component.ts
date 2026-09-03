import {
	AfterViewInit,
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	HostListener,
	OnDestroy,
	ViewChild,
	computed,
	effect,
	inject,
	input,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, shareReplay } from 'rxjs';
import { DEFAULT_FEN } from '../../core/chess/fen.util';
import { composePgnFile } from '../../core/chess/pgn-file';
import { PgnParserService } from '../../core/chess/pgn-parser.service';
import { PgnSerializerService } from '../../core/chess/pgn-serializer.service';
import { ItemType } from '../../core/models/collection.model';
import { RepertoireTree } from '../../core/models/repertoire.model';
import { OpponentScope, SearchColor } from '../../core/models/search.model';
import { NotificationService } from '../../core/services/notification.service';
import { CloudStorageService } from '../../core/services/cloud-storage.service';
import { CollectionApiService } from '../../core/services/collection-api.service';
import { LocalShelfService } from '../../core/agent/local-shelf.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { OpeningExplorerService } from '../../core/services/opening-explorer.service';
import { ViewportService } from '../../core/layout/viewport.service';
import { AuthService } from '../../core/services/auth.service';
import { AnalyticsService } from '../../core/analytics/analytics.service';
import { AnalyticsEvent } from '../../core/analytics/analytics.events';
import { ReportApiService } from '../../core/services/report-api.service';
import { BoardToolbarComponent } from './board-toolbar/board-toolbar.component';
import { SavedEntry } from './board-toolbar/game-file-dialog.component';
import { ChessBoardComponent } from './chess-board/chess-board.component';
import { NotationPanelComponent } from './notation-panel/notation-panel.component';
import { EngineStore } from './state/engine.store';
import { TablebaseStore } from './state/tablebase.store';
import { GameListStore } from './state/game-list.store';
import { GamePreviewStore } from './state/game-preview.store';
import { MoveTreeStore } from './state/move-tree.store';
import { OpeningExplorerStore } from './state/opening-explorer.store';
import { ReportStore } from './state/report.store';

@Component({
	selector: 'app-analysis-board',
	standalone: true,
	imports: [BoardToolbarComponent, ChessBoardComponent, NotationPanelComponent],
	templateUrl: './analysis-board.component.html',
	styleUrl: './analysis-board.component.scss',
	providers: [
		MoveTreeStore,
		EngineStore,
		TablebaseStore,
		OpeningExplorerStore,
		GameListStore,
		GamePreviewStore,
		ReportStore,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisBoardComponent implements AfterViewInit, OnDestroy {
	private readonly engine = inject(EngineStore);
	private readonly tree = inject(MoveTreeStore);
	private readonly preview = inject(GamePreviewStore);
	private readonly explorer = inject(OpeningExplorerStore);
	private readonly api = inject(OpeningExplorerService);
	readonly viewport = inject(ViewportService);
	readonly report = inject(ReportStore);
	private readonly reportApi = inject(ReportApiService);
	private readonly auth = inject(AuthService);
	private readonly analytics = inject(AnalyticsService);
	private readonly pgn = inject(PgnParserService);
	private readonly serializer = inject(PgnSerializerService);
	private readonly notify = inject(NotificationService);
	private readonly cloud = inject(CloudStorageService);
	private readonly collections = inject(CollectionApiService);
	private readonly localShelf = inject(LocalShelfService);
	private readonly router = inject(Router);
	private readonly confirmDialog = inject(ConfirmService);

	/** ?game=<id> opens a game from the archive. */
	readonly game = input<string | undefined>(undefined);

	private loadedGame?: string;

	/** ?item=<id> opens an entry from the Library or Repertoire. */
	readonly item = input<string | undefined>(undefined);

	/** ?local=<id> opens a game from a file in the agent's linked folder. */
	readonly local = input<string | undefined>(undefined);

	private loadedLocal?: string;

	private loadedItem?: string;

	private loadedReport?: string;

	/** ?ply=<n> opens n half-moves into whatever was loaded. */
	readonly ply = input<string | undefined>(undefined);

	private openAtPly(board: ChessBoardComponent): void {
		const line = this.line()?.trim();
		if (line) {
			this.tree.goToLine(line.split(',').filter((uci) => uci.length >= 4));
			board.refresh();
			return;
		}

		const ply = Number(this.ply());
		if (!Number.isInteger(ply) || ply <= 0) {
			return;
		}
		this.tree.goToMainlinePly(ply);
		board.refresh();
	}

	/** ?line=e2e4,e7e5,g1f3 does the same as ?ply= for a specific line. */
	readonly line = input<string | undefined>(undefined);

	readonly opponent = input<string | undefined>(undefined);
	readonly oppColor = input<string | undefined>(undefined);
	readonly oppFrom = input<string | undefined>(undefined);
	readonly oppTo = input<string | undefined>(undefined);
	readonly oppName = input<string | undefined>(undefined);

	/** ?report=1 reads the same opponent as an Advanced Report. */
	readonly reportMode = input(false, {
		// eslint-disable-next-line @angular-eslint/no-input-rename -- 'report' is the query parameter's own name
		alias: 'report',
		transform: (value: unknown) => value === '1' || value === true || value === 'true',
	});

	readonly opponentScope = computed<OpponentScope | null>(() => {
		const fideId = Number(this.opponent());
		if (!Number.isInteger(fideId) || fideId <= 0) {
			return null;
		}
		return {
			fideId,
			color: this.oppColor() === 'b' ? ('b' as SearchColor) : ('w' as SearchColor),
			from: this.oppFrom()?.trim() || null,
			to: this.oppTo()?.trim() || null,
			name: this.oppName()?.trim() || null,
		};
	});

	readonly opponentTreeOnly = computed(() => this.opponentScope() !== null && !this.reportMode());

	readonly opponentLabel = computed(() => {
		const scope = this.opponentScope();
		if (!scope) {
			return '';
		}
		const who = scope.name ?? `FIDE ${scope.fideId}`;
		return `${who} — as ${scope.color === 'b' ? 'Black' : 'White'}`;
	});

	private readonly siblings = signal<readonly number[]>([]);
	private siblingsOf?: number;

	readonly stepTargets = computed<{ previous: number | null; next: number | null }>(() => {
		const ids = this.siblings();
		const index = ids.indexOf(Number(this.item()));
		if (index < 0) {
			return { previous: null, next: null };
		}
		return { previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
	});

	@ViewChild('mainRef') private mainRef!: ElementRef<HTMLElement>;
	@ViewChild('dividerRef') private dividerRef!: ElementRef<HTMLElement>;
	@ViewChild('boardPaneRef') private boardPaneRef?: ElementRef<HTMLElement>;
	private readonly hostEl = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;

	private readonly board = viewChild(ChessBoardComponent);

	dismissVariationPicker(): void {
		this.board()?.dismissVariationPicker();
	}

	private readonly toolbar = viewChild(BoardToolbarComponent);

	private resizeObserver?: ResizeObserver;

	readonly notationWidth = signal<number | null>(null);

	private readonly minNotationPx = signal(0);

	readonly resizing = signal(false);

	readonly handleOffset = signal<number | null>(null);

	readonly handleActive = signal(false);

	/** Below this pane width the board freezes and the pane scrolls. */
	private static readonly MIN_BOARD_PANE_PX = 370;

	/** First guess at the board pane's width, before the board has measured itself. */
	private static readonly BOARD_PANE_AT_MAX_PX = 767;

	private dividerWidth(): number {
		return this.dividerRef?.nativeElement.getBoundingClientRect().width ?? 0;
	}

	private clampNotation(width: number, containerWidth: number): number {
		const min = this.minNotationPx();
		const max = Math.max(min, containerWidth - this.dividerWidth() - AnalysisBoardComponent.MIN_BOARD_PANE_PX);
		return Math.min(Math.max(width, min), max);
	}

	private notationWidthAt(clientX: number, rect: DOMRect): number {
		return this.clampNotation(rect.right - clientX - this.dividerWidth() / 2, rect.width);
	}

	private defaultNotationWidth(containerWidth: number): number {
		return containerWidth - this.dividerWidth() - AnalysisBoardComponent.BOARD_PANE_AT_MAX_PX;
	}

	private dividerTouched = false;

	constructor() {
		effect(() => {
			const preferred = this.board()?.layout.preferredPaneWidth();
			if (this.dividerTouched || preferred == null) return;

			const mainEl = this.mainRef?.nativeElement;
			if (!mainEl) return;
			const containerWidth = mainEl.getBoundingClientRect().width;
			if (containerWidth <= 0) return;

			const target = containerWidth - this.dividerWidth() - preferred;
			const current = this.notationWidth();
			if (current !== null && target <= current + 0.5) return;

			this.notationWidth.set(this.clampNotation(target, containerWidth));
		});

		effect(() => {
			this.board()?.setAutoShapes([...this.engine.boardShapes(), ...this.report.boardShapes()]);
		});

		effect(() => {
			this.preview.tree();
			const board = this.board();
			untracked(() => board?.refresh());
		});

		effect(() => {
			const scope = this.opponentScope();
			const board = this.board();
			if (!this.reportMode() || !scope || !board) {
				return;
			}
			const key = `${scope.fideId}|${scope.color}|${scope.from}|${scope.to}`;
			if (this.loadedReport === key) {
				return;
			}
			this.loadedReport = key;

			this.reportApi.advanced(scope).subscribe({
				next: (data) => {
					this.report.build(data);
					board.refresh();
					this.tree.markSaved();
					this.analytics.capture(AnalyticsEvent.advancedReportViewed, {
						authenticated: this.auth.isAuthenticated(),
						overlaps: data?.overlaps ?? 0,
						deviations: data?.deviations ?? 0,
						games_read: data?.gamesRead ?? 0,
						repertoire_files: data?.repertoireFiles ?? 0,
					});
				},
				error: (err: Error) => {
					this.report.build(null);
					this.notify.error(err.message);
				},
			});
		});

		effect(() => {
			this.tree.currentNode();
			this.tree.revision();
			untracked(() => this.report.syncToCursor());
		});

		effect(() => this.explorer.setScope(this.opponentScope()));

		effect(() => {
			const id = this.game();
			const board = this.board();
			if (!id || !board || this.loadedGame === id) return;

			this.loadedGame = id;
			this.api.game(Number(id)).subscribe({
				next: (detail) => {
					const parsed = this.pgn.parse(detail.pgn);
					this.tree.adopt(parsed.root, parsed.headers);
					board.refresh();
					this.openAtPly(board);
					this.tree.markSaved();
				},
			});
		});

		effect(() => {
			const id = this.item();
			const board = this.board();
			if (!id || this.game() || !board || this.loadedItem === id) return;

			this.loadedItem = id;

			const layer = this.preloadRepertoire(Number(id));

			this.collections.getItem(Number(id)).subscribe({
				next: (detail) => {
					const parsed = this.pgn.parse(detail.pgn);
					this.tree.adopt(parsed.root, parsed.headers, detail.itemType === 'STUDY');
					board.refresh();
					this.openAtPly(board);
					this.tree.markSaved();
					this.loadSiblings(detail.collectionId);

					this.openItemType.set(detail.itemType);
					if (detail.itemType === 'MAIN_LINE') {
						this.applyRepertoire(layer, board, true);
					}
				},
			});
		});

		effect(() => {
			const id = this.local();
			const board = this.board();
			if (!id || this.game() || this.item() || !board || this.loadedLocal === id) return;

			this.loadedLocal = id;

			this.localShelf
				.entry(id)
				.then((detail) => {
					const parsed = this.pgn.parse(detail.pgn);
					this.tree.adopt(parsed.root, parsed.headers, detail.itemType === 'STUDY');
					board.refresh();
					this.openAtPly(board);
					this.tree.markSaved();
				})
				.catch((error: Error) => {
					this.notify.error(error.message);
				});
		});
	}

	private readonly openItemType = signal<ItemType | null>(null);

	private refreshRepertoire(itemId: number): void {
		this.applyRepertoire(this.preloadRepertoire(itemId), this.board(), false);
	}

	private preloadRepertoire(itemId: number): Observable<RepertoireTree | null> {
		return this.collections.repertoireTree(itemId).pipe(
			catchError(() => of(null)),
			shareReplay({ bufferSize: 1, refCount: false }),
		);
	}

	private applyRepertoire(
		layer: Observable<RepertoireTree | null>,
		board: ChessBoardComponent | undefined,
		reopen: boolean,
	): void {
		layer.subscribe((links) => {
			this.tree.applyRepertoireTree(links);
			const target = board ?? this.board();
			if (!target) {
				return;
			}
			/** Only on the way in: a save must not pull the cursor back. */
			if (reopen) {
				this.openAtPly(target);
				this.tree.markSaved();
			}
			target.refresh();
		});
	}

	private loadSiblings(collectionId: number): void {
		if (this.siblingsOf === collectionId) {
			return;
		}
		this.siblingsOf = collectionId;

		this.collections.listItems(collectionId, 'MANUAL', true).subscribe({
			next: (items) => this.siblings.set(items.map((item) => item.id)),
			error: () => this.siblings.set([]),
		});
	}

	readonly openItemId = computed(() => {
		if (this.game()) {
			return null;
		}
		const id = Number(this.item());
		return Number.isInteger(id) && id > 0 ? id : null;
	});

	openEntry(id: number | null): void {
		if (id === null) {
			return;
		}
		void this.confirmDiscardOrSave().then((proceed) => {
			if (!proceed) {
				return;
			}
			void this.router.navigate([], { queryParams: { item: id }, queryParamsHandling: 'merge' });
		});
	}

	readonly confirmReplaceBoard = async (): Promise<boolean> => {
		if (!(await this.confirmDiscardOrSave())) {
			return false;
		}
		this.detachFromEntry();
		return true;
	};

	private detachFromEntry(): void {
		if (!this.game() && !this.item() && !this.local() && !this.ply() && !this.line()) {
			return;
		}
		void this.router.navigate([], {
			queryParams: { game: null, item: null, local: null, ply: null, line: null },
			queryParamsHandling: 'merge',
		});
	}

	async confirmDiscardOrSave(): Promise<boolean> {
		if (!this.tree.isDirty()) {
			return true;
		}
		const answer = await this.confirmDialog.askOrDismiss('Save changes?', {
			confirmLabel: 'Save',
			cancelLabel: 'Discard',
		});
		/** The cross, or Escape: stay where we are, with the work still unsaved and still there. */
		if (answer === 'dismiss') {
			return false;
		}
		if (answer === 'confirm') {
			return await this.quickSave();
		}
		return true;
	}

	async quickSave(): Promise<boolean> {
		const itemId = this.openItemId();
		if (itemId === null) {
			this.toolbar()?.openGameDataPanel();
			return false;
		}

		const headers = this.tree.headers();
		const root = this.tree.root();
		const pgn = composePgnFile({
			headers,
			startFen: root?.fen ?? DEFAULT_FEN,
			movetext: this.serializer.movetext(root),
			annotator: headers.annotator ?? null,
		});

		return await new Promise<boolean>((resolve) => {
			this.collections.updateItem(itemId, pgn).subscribe({
				next: () => {
					this.tree.markSaved();
					/** A trunk's own moves may also be moves a model game plays, so the layer is re-read. */
					if (this.openItemType() === 'MAIN_LINE') {
						this.refreshRepertoire(itemId);
					}
					this.notify.info('Saved.');
					resolve(true);
				},
				error: (err: Error) => {
					if (!this.cloud.reportFull(err)) {
						this.notify.error(err.message);
					}
					resolve(false);
				},
			});
		});
	}

	@HostListener('window:keydown', ['$event'])
	onGlobalKeydown(event: KeyboardEvent): void {
		if (event.key.toLowerCase() !== 's' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) {
			return;
		}
		event.preventDefault();
		void this.quickSave();
	}

	onSavedToCollection(entry: SavedEntry): void {
		this.loadedItem = String(entry.itemId);
		this.siblingsOf = undefined;
		this.loadSiblings(entry.collectionId);

		if (this.openItemType() === 'MAIN_LINE') {
			this.refreshRepertoire(entry.itemId);
		}
		void this.router.navigate([], { queryParams: { item: entry.itemId }, queryParamsHandling: 'merge' });
	}

	private applyClamp(containerWidth: number): void {
		if (containerWidth <= 0) {
			return;
		}
		const current = this.notationWidth();
		const target = current ?? this.defaultNotationWidth(containerWidth);
		const clamped = this.clampNotation(target, containerWidth);
		if (current === null || Math.abs(clamped - current) > 0.5) {
			this.notationWidth.set(clamped);
		}
	}

	onNotationMinWidth(px: number): void {
		this.minNotationPx.set(px);
		const mainEl = this.mainRef?.nativeElement;
		if (mainEl) {
			this.applyClamp(mainEl.getBoundingClientRect().width);
		}
	}

	ngAfterViewInit(): void {
		const mainEl = this.mainRef?.nativeElement;
		if (!mainEl) return;

		this.resizeObserver = new ResizeObserver(() => {
			this.applyClamp(mainEl.getBoundingClientRect().width);
			this.publishOverlayBounds();
		});
		this.resizeObserver.observe(mainEl);

		window.addEventListener('scroll', this.publishOverlayBounds, { passive: true });
		this.publishOverlayBounds();
	}

	private readonly publishOverlayBounds = (): void => {
		const style = this.hostEl.style;
		if (!this.viewport.isMobile()) {
			style.removeProperty('--board-overlay-top');
			style.removeProperty('--board-overlay-bottom');
			return;
		}

		const pane = this.boardPaneRef?.nativeElement.getBoundingClientRect();
		if (!pane) return;

		style.setProperty('--board-overlay-top', `${Math.round(pane.top)}px`);
		style.setProperty('--board-overlay-bottom', `${Math.round(pane.bottom)}px`);
	};

	ngOnDestroy(): void {
		window.removeEventListener('scroll', this.publishOverlayBounds);
		this.resizeObserver?.disconnect();
	}

	startResize(event: PointerEvent): void {
		event.preventDefault();
		this.dividerTouched = true;
		this.resizing.set(true);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	onResize(event: PointerEvent, mainEl: HTMLElement): void {
		if (!this.resizing()) {
			return;
		}
		this.notationWidth.set(this.notationWidthAt(event.clientX, mainEl.getBoundingClientRect()));
	}

	stopResize(): void {
		this.resizing.set(false);
	}

	onHandlePointerDown(event: PointerEvent): void {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.dividerTouched = true;
		this.handleActive.set(true);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	onHandleDrag(event: PointerEvent, mainEl: HTMLElement): void {
		if (!this.handleActive()) {
			return;
		}
		event.preventDefault();
		const rect = mainEl.getBoundingClientRect();

		this.notationWidth.set(this.notationWidthAt(event.clientX, rect));

		const handleHeight = (event.currentTarget as HTMLElement).offsetHeight;
		const yMin = 16;
		const yMax = rect.height - yMin - handleHeight;
		const y = Math.min(Math.max(event.clientY - rect.top, yMin), yMax);
		this.handleOffset.set(y);
	}

	onHandlePointerUp(event: PointerEvent): void {
		if (!this.handleActive()) {
			return;
		}
		event.stopPropagation();
		this.handleActive.set(false);
	}
}
