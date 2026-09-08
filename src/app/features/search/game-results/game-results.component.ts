import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	input,
	output,
	signal,
	HostListener,
} from '@angular/core';
import { GameDetail } from '../../../core/models/game-list.model';
import { SearchResultGame, SearchSortKey } from '../../../core/models/search.model';
import { OpeningExplorerService } from '../../../core/services/opening-explorer.service';
import { PreviewBoardComponent } from '../../collections/preview-board/preview-board.component';
import { ViewportService } from '../../../core/layout/viewport.service';
import { GameContextMenuComponent } from '../../analysis-board/notation-panel/game-list/game-context-menu/game-context-menu.component';

interface ResultColumn {
	readonly key: string;
	readonly label: string;
	readonly align: 'left' | 'right' | 'center';
	readonly width?: number;
	readonly sort?: SearchSortKey;
}

const COLUMNS: readonly ResultColumn[] = [
	{ key: 'white', label: 'White', align: 'left', sort: 'WHITE_NAME' },
	{ key: 'whiteElo', label: 'Elo', align: 'right', width: 62, sort: 'WHITE_ELO' },
	{ key: 'black', label: 'Black', align: 'left', sort: 'BLACK_NAME' },
	{ key: 'blackElo', label: 'Elo', align: 'right', width: 62, sort: 'BLACK_ELO' },
	{ key: 'result', label: 'Result', align: 'center', width: 78, sort: 'RESULT' },
	{ key: 'moves', label: 'Moves', align: 'right', width: 70, sort: 'MOVES' },
	{ key: 'eco', label: 'ECO', align: 'center', width: 62, sort: 'ECO' },
	{ key: 'event', label: 'Event', align: 'left', sort: 'EVENT' },
	{ key: 'date', label: 'Date', align: 'right', width: 108, sort: 'DATE' },
];

const ELASTIC_MIN_PX = 150;

const MIN_PREVIEW_PX = 300;
const DEFAULT_PREVIEW_PX = 380;
const HANDLE_MARGIN_PX = 24;
const LIST_GUTTER_PX = 20;

/** Mirrors the duration of the preview-sheet-up keyframes in the stylesheet. */
const SHEET_ENTER_MS = 240;

@Component({
	selector: 'app-game-results',
	standalone: true,
	imports: [PreviewBoardComponent, GameContextMenuComponent],
	templateUrl: './game-results.component.html',
	styleUrl: './game-results.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameResultsComponent {
	private readonly archive = inject(OpeningExplorerService);

	readonly rows = input.required<readonly SearchResultGame[]>();
	readonly loading = input(false);
	readonly hasMore = input(false);
	readonly sort = input.required<SearchSortKey>();
	readonly ascending = input.required<boolean>();

	readonly placeholder = input('Run a search to see games here.');

	/** False while this list is on a tab nobody is looking at. */
	readonly active = input(true);

	readonly sortRequested = output<SearchSortKey>();
	readonly moreRequested = output<void>();

	readonly columns = COLUMNS;

	readonly tableMinWidth = COLUMNS.reduce((total, column) => total + (column.width ?? ELASTIC_MIN_PX), 0);

	// Selection and preview

	readonly selectedId = signal<number | null>(null);
	readonly selectedGame = computed(() => this.rows().find((row) => row.id === this.selectedId()) ?? null);

	/** The fetched PGN of the selected row, or null while it is in flight. */
	readonly previewPgn = signal<string | null>(null);

	readonly viewport = inject(ViewportService);

	readonly sheetOffset = signal(0);
	private sheetDragFrom: number | null = null;

	/**
	 * The sheet carries `transition: transform` so that letting go animates it back. While a finger is
	 * down that transition is the bug: every pointermove sets a new transform and the browser spends
	 * 180ms easing towards it, so the sheet trails the finger and replays the movement after it stops.
	 * `dragging` turns the transition off for the duration, which is what makes it follow rather than
	 * chase.
	 */
	readonly sheetDragging = signal(false);

	private sheetStartedAt = 0;

	onSheetPointerDown(event: PointerEvent): void {
		/**
		 * Touch only. A mouse has the close button and never needs to throw a sheet away, and letting a
		 * mouse arm this gesture is how a stuck sheetDragFrom turned an ordinary hover into a 529px
		 * translate that left the sheet parked halfway down the screen.
		 */
		if (!this.viewport.isMobile() || event.pointerType !== 'touch') return;
		event.preventDefault();
		this.sheetDragFrom = event.clientY;
		this.sheetStartedAt = event.timeStamp;
		this.sheetOffset.set(0);
		this.sheetDragging.set(true);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	onSheetPointerMove(event: PointerEvent): void {
		if (this.sheetDragFrom === null) return;
		/** Belt and braces: if the press was lost without a pointerup, stop rather than follow. */
		if (event.buttons === 0 && event.pointerType !== 'touch') {
			this.onSheetPointerUp();
			return;
		}
		/** Downward only. Dragging up would lift the sheet off the top of the screen. */
		this.sheetOffset.set(Math.max(0, event.clientY - this.sheetDragFrom));
	}

	onSheetPointerUp(event?: PointerEvent): void {
		if (this.sheetDragFrom === null) return;
		this.sheetDragFrom = null;
		this.sheetDragging.set(false);

		const travelled = this.sheetOffset();
		const elapsed = event ? Math.max(1, event.timeStamp - this.sheetStartedAt) : 1;
		const speed = travelled / elapsed;

		/**
		 * A quarter of the screen, or a flick. Distance alone means a quick short swipe - which is what
		 * dismissing a sheet actually feels like - does nothing, and the sheet springs back at you.
		 */
		if (travelled > window.innerHeight / 4 || (speed > 0.5 && travelled > 40)) {
			/** Left where it is: the element is about to be removed, and snapping it back to the top
			    for one frame first is exactly the jump this was meant to fix. */
			this.closePreview();
			return;
		}
		this.sheetOffset.set(0);
	}

	private previewRequestId = 0;

	constructor() {
		effect(() => {
			const id = this.selectedId();
			if (id !== null && !this.rows().some((row) => row.id === id)) {
				this.selectedId.set(null);
				this.previewPgn.set(null);
			}
		});
	}

	select(row: SearchResultGame): void {
		if (this.selectedId() === row.id) {
			return;
		}

		/** Opening from nothing is an entrance; stepping to the next game is not. */
		if (this.selectedId() === null) {
			this.sheetEntering.set(true);
			setTimeout(() => this.sheetEntering.set(false), SHEET_ENTER_MS);
		}

		this.resetSheet();
		this.selectedId.set(row.id);

		/**
		 * The previous game stays on the board until the next one arrives. Clearing it first put an
		 * empty board on screen for the length of a request, which on a phone reads as the sheet
		 * leaving and coming back - and the sheet is the only thing between a finger and the header
		 * behind it.
		 */
		const request = ++this.previewRequestId;
		this.archive.game(row.id).subscribe({
			next: (detail: GameDetail) => {
				if (request !== this.previewRequestId) return;
				this.previewPgn.set(detail.pgn);
			},
			error: () => {
				if (request !== this.previewRequestId) return;
				this.previewPgn.set('');
			},
		});
	}

	/**
	 * True only for the length of the opening animation. The animation lives on this class rather than
	 * on .preview so that nothing which merely changes the sheet's contents can replay it.
	 */
	readonly sheetEntering = signal(false);

	/** Nothing that opens or changes the sheet may inherit an offset from whatever happened before. */
	private resetSheet(): void {
		this.sheetDragFrom = null;
		this.sheetDragging.set(false);
		this.sheetOffset.set(0);
	}

	closePreview(): void {
		this.selectedId.set(null);
		this.previewPgn.set(null);
		this.sheetDragFrom = null;
		this.sheetDragging.set(false);
		/** Not reset while the sheet is being dismissed - see onSheetPointerUp - but it must not be
		    carried into the next one, and by now the element is gone. */
		this.sheetOffset.set(0);
	}

	openInNewTab(row: SearchResultGame): void {
		window.open(`/analysis?game=${row.id}`, '_blank', 'noopener');
	}

	readonly openMenu = signal<{ game: SearchResultGame; anchor: DOMRect } | null>(null);

	onContextMenu(event: MouseEvent, game: SearchResultGame): void {
		event.preventDefault();
		event.stopPropagation();
		this.openMenu.set({ game, anchor: (event.currentTarget as HTMLElement).getBoundingClientRect() });
	}

	@HostListener('document:click')
	@HostListener('document:contextmenu')
	@HostListener('window:blur')
	closeMenu(): void {
		this.openMenu.set(null);
	}

	@HostListener('document:keydown.escape')
	onMenuEscape(): void {
		this.closeMenu();
	}

	selectPrevious(): void {
		this.step(-1);
	}

	selectNext(): void {
		this.step(1);
	}

	/** The index of the previewed game, or -1. Both header arrows are derived from it. */
	private readonly selectedIndex = computed(() => this.rows().findIndex((row) => row.id === this.selectedId()));

	readonly hasPreviousGame = computed(() => this.selectedIndex() > 0);
	readonly hasNextGame = computed(() => {
		const at = this.selectedIndex();
		return at !== -1 && at < this.rows().length - 1;
	});

	private step(delta: number): void {
		const rows = this.rows();
		if (rows.length === 0) {
			return;
		}
		const current = rows.findIndex((row) => row.id === this.selectedId());
		const next = current === -1 ? (delta > 0 ? 0 : rows.length - 1) : current + delta;
		if (next < 0 || next >= rows.length) {
			return;
		}
		this.select(rows[next]);
	}

	cellText(row: SearchResultGame, key: string): string {
		switch (key) {
			case 'white':
				return row.white?.trim() || '?';
			case 'black':
				return row.black?.trim() || '?';
			case 'whiteElo':
				return row.whiteElo === null ? '—' : String(row.whiteElo);
			case 'blackElo':
				return row.blackElo === null ? '—' : String(row.blackElo);
			case 'result':
				return row.result || '*';
			case 'moves':
				return row.plyCount ? String(Math.ceil(row.plyCount / 2)) : '—';
			case 'eco':
				return row.eco?.trim() || '—';
			case 'event':
				return row.event?.trim() || '—';
			case 'date':
				return formatDate(row);
			default:
				return '';
		}
	}

	isUnknown(row: SearchResultGame, key: string): boolean {
		const text = this.cellText(row, key);
		return text === '?' || text === '—' || text === '*' || text.startsWith('????');
	}

	ariaSort(column: ResultColumn): 'ascending' | 'descending' | null {
		if (!column.sort || column.sort !== this.sort()) {
			return null;
		}
		return this.ascending() ? 'ascending' : 'descending';
	}

	onHeaderClick(column: ResultColumn): void {
		if (column.sort) {
			this.sortRequested.emit(column.sort);
		}
	}

	// Splitter

	readonly previewWidth = signal(DEFAULT_PREVIEW_PX);
	readonly resizing = signal(false);
	readonly handleOffset = signal<number | null>(null);
	readonly handleActive = signal(false);

	readonly listGutterRight = computed(() =>
		this.selectedId() !== null ? this.previewWidth() + LIST_GUTTER_PX : LIST_GUTTER_PX,
	);

	startResize(event: PointerEvent): void {
		event.preventDefault();
		this.resizing.set(true);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	onResize(event: PointerEvent, body: HTMLElement): void {
		if (!this.resizing()) {
			return;
		}
		const rect = body.getBoundingClientRect();
		const width = rect.right - event.clientX;
		this.previewWidth.set(Math.min(Math.max(width, MIN_PREVIEW_PX), Math.max(rect.width / 2, MIN_PREVIEW_PX)));
	}

	stopResize(): void {
		this.resizing.set(false);
	}

	onHandlePointerDown(event: PointerEvent): void {
		event.preventDefault();
		event.stopPropagation();
		this.handleActive.set(true);
		this.resizing.set(true);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	onHandleDrag(event: PointerEvent, body: HTMLElement): void {
		if (!this.handleActive()) {
			return;
		}
		this.onResize(event, body);
		const rect = body.getBoundingClientRect();
		const y = event.clientY - rect.top;
		this.handleOffset.set(
			Math.min(Math.max(y, HANDLE_MARGIN_PX), Math.max(rect.height - HANDLE_MARGIN_PX, HANDLE_MARGIN_PX)),
		);
	}

	onHandlePointerUp(): void {
		this.handleActive.set(false);
		this.resizing.set(false);
	}
}

function formatDate(row: SearchResultGame): string {
	if (row.date) {
		return row.date.replace(/-/g, '.');
	}
	return row.year ? `${row.year}.??.??` : '????.??.??';
}
