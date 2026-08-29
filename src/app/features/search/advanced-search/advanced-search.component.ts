import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import {
	AdvancedCriteria,
	EMPTY_ADVANCED_CRITERIA,
	SearchResultGame,
	SearchSortKey,
	isCriteriaEmpty,
} from '../../../core/models/search.model';
import { NotificationService } from '../../../core/services/notification.service';
import { AnalyticsService } from '../../../core/analytics/analytics.service';
import { AnalyticsEvent } from '../../../core/analytics/analytics.events';
import { AuthService } from '../../../core/services/auth.service';
import { AgentSelectionStore } from '../../../core/agent/agent-selection.store';
import { SearchApiService } from '../../../core/services/search-api.service';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { GameResultsComponent } from '../game-results/game-results.component';
import { ViewportService } from '../../../core/layout/viewport.service';

/** Autocomplete debounce. */
const SUGGEST_DEBOUNCE_MS = 200;
const MIN_SUGGEST_LENGTH = 3;

const RESULTS: readonly { value: string; label: string }[] = [
	{ value: '1-0', label: '1-0' },
	{ value: '1/2-1/2', label: '½-½' },
	{ value: '0-1', label: '0-1' },
];

@Component({
	selector: 'app-advanced-search',
	standalone: true,
	imports: [GameResultsComponent, DatePickerComponent],
	templateUrl: './advanced-search.component.html',
	styleUrl: './advanced-search.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedSearchComponent {
	private readonly api = inject(SearchApiService);
	private readonly notify = inject(NotificationService);
	private readonly viewport = inject(ViewportService);
	/** Which archive the page is answering from. */
	private readonly selection = inject(AgentSelectionStore);
	private readonly auth = inject(AuthService);
	private readonly analytics = inject(AnalyticsService);

	readonly previewLabel = computed(() => this.selection.database()?.name ?? 'the archive');

	readonly results = RESULTS;

	readonly collapsible = computed(() => !this.viewport.isMobile());

	private readonly foldRequested = signal(false);

	readonly barCollapsed = computed(() => this.collapsible() && this.foldRequested());
	readonly handleOffset = signal<number | null>(null);
	readonly handleDragging = signal(false);
	private dragStartX = 0;
	private dragMoved = false;

	startHandleDrag(event: PointerEvent): void {
		event.preventDefault();
		this.handleDragging.set(true);
		this.dragMoved = false;
		this.dragStartX = event.clientX;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	onHandleDrag(event: PointerEvent, bar: HTMLElement): void {
		if (!this.handleDragging()) {
			return;
		}
		if (Math.abs(event.clientX - this.dragStartX) > 3) {
			this.dragMoved = true;
		}
		const rect = bar.getBoundingClientRect();
		const margin = 24;
		const x = Math.min(Math.max(event.clientX - rect.left, margin), Math.max(rect.width - margin, margin));
		this.handleOffset.set(x);
	}

	stopHandleDrag(): void {
		if (!this.handleDragging()) {
			return;
		}
		this.handleDragging.set(false);
		if (!this.dragMoved) {
			this.foldRequested.update((collapsed) => !collapsed);
		}
	}

	readonly criteria = signal<AdvancedCriteria>(EMPTY_ADVANCED_CRITERIA);

	readonly rows = signal<readonly SearchResultGame[]>([]);
	readonly loading = signal(false);
	readonly hasMore = signal(false);
	readonly searched = signal(false);
	readonly sort = signal<SearchSortKey>('DATE');
	readonly ascending = signal(false);
	private page = 0;

	readonly previewRows = signal<readonly SearchResultGame[]>([]);
	readonly previewLoading = signal(false);

	readonly previewing = computed(() => !this.searched() && !this.loading());

	private active: AdvancedCriteria | null = null;

	readonly canSearch = computed(() => !isCriteriaEmpty(this.criteria()) && !this.loading());

	readonly displayRows = computed(() => (this.previewing() ? this.previewRows() : this.rows()));

	readonly resultsPlaceholder = computed(() =>
		this.searched() ? 'No games in the archive match these criteria.' : 'Fill in at least one field and press Search.',
	);

	constructor() {
		effect(() => {
			this.selection.database();
			this.loadPreview();
		});
	}

	private loadPreview(): void {
		this.previewLoading.set(true);
		this.api.recent(this.sort(), this.ascending()).subscribe({
			next: (result) => {
				this.previewRows.set(result.games);
				this.previewLoading.set(false);
			},
			error: () => {
				this.previewRows.set([]);
				this.previewLoading.set(false);
			},
		});
	}

	valueOf(key: keyof AdvancedCriteria): string {
		const value = this.criteria()[key];
		return typeof value === 'string' ? value : '';
	}

	isResult(value: string): boolean {
		return this.criteria().results.includes(value);
	}

	readonly anyResult = computed(() => this.criteria().results.length === 0);

	onField(key: keyof AdvancedCriteria, event: Event): void {
		this.setField(key, (event.target as HTMLInputElement | HTMLSelectElement).value);
	}

	// Name autocomplete.

	readonly whiteSuggestions = signal<readonly string[]>([]);
	readonly blackSuggestions = signal<readonly string[]>([]);

	private readonly suggestTimers: Record<'white' | 'black', ReturnType<typeof setTimeout> | null> = {
		white: null,
		black: null,
	};

	private readonly suggestRequestIds: Record<'white' | 'black', number> = { white: 0, black: 0 };

	onNameField(key: 'white' | 'black', event: Event): void {
		const value = (event.target as HTMLInputElement).value;
		this.setField(key, value);

		const timer = this.suggestTimers[key];
		if (timer !== null) {
			clearTimeout(timer);
		}

		const trimmed = value.trim();
		if (trimmed.length < MIN_SUGGEST_LENGTH) {
			this.suggestionsFor(key).set([]);
			return;
		}
		this.suggestTimers[key] = setTimeout(() => this.fetchSuggestions(key, trimmed), SUGGEST_DEBOUNCE_MS);
	}

	private suggestionsFor(key: 'white' | 'black') {
		return key === 'white' ? this.whiteSuggestions : this.blackSuggestions;
	}

	private fetchSuggestions(key: 'white' | 'black', query: string): void {
		const request = ++this.suggestRequestIds[key];
		this.api.suggestArchivePlayers(query).subscribe({
			next: (list) => {
				if (request !== this.suggestRequestIds[key]) return;
				this.suggestionsFor(key).set(list.map((player) => player.name));
			},
			error: () => {
				if (request !== this.suggestRequestIds[key]) return;
				this.suggestionsFor(key).set([]);
			},
		});
	}

	setField(key: keyof AdvancedCriteria, value: string): void {
		this.criteria.update((current) => ({ ...current, [key]: value }));
	}

	toggleIgnoreColours(): void {
		this.criteria.update((current) => ({ ...current, ignoreColours: !current.ignoreColours }));
	}

	toggleResult(value: string): void {
		this.criteria.update((current) => {
			const kept = current.results.includes(value)
				? current.results.filter((token) => token !== value)
				: [...current.results, value];
			return { ...current, results: kept.length === RESULTS.length ? [] : kept };
		});
	}

	clearResults(): void {
		this.criteria.update((current) => ({ ...current, results: [] }));
	}

	clear(): void {
		this.criteria.set(EMPTY_ADVANCED_CRITERIA);
		this.rows.set([]);
		this.hasMore.set(false);
		this.searched.set(false);
		this.active = null;
		this.loadPreview();
	}

	search(): void {
		if (isCriteriaEmpty(this.criteria())) {
			this.notify.error('Fill in at least one search field.');
			return;
		}
		this.analytics.capture(AnalyticsEvent.opponentSearch, {
			mode: 'advanced',
			authenticated: this.auth.isAuthenticated(),
			source: this.selection.usingLocalDatabase() ? 'local' : 'cloud',
		});

		this.active = this.criteria();
		this.page = 0;
		this.rows.set([]);
		this.load(false);
	}

	onSort(key: SearchSortKey): void {
		if (this.sort() === key) {
			this.ascending.update((value) => !value);
		} else {
			this.sort.set(key);
			this.ascending.set(key === 'WHITE_NAME' || key === 'BLACK_NAME' || key === 'EVENT' || key === 'ECO');
		}

		if (!this.active) {
			this.loadPreview();
			return;
		}

		this.page = 0;
		this.rows.set([]);
		this.load(false);
	}

	loadMore(): void {
		if (this.active && !this.loading()) {
			this.page++;
			this.load(true);
		}
	}

	private load(append: boolean): void {
		const active = this.active;
		if (!active) {
			return;
		}
		this.loading.set(true);

		this.api.advanced(active, this.sort(), this.ascending(), this.page).subscribe({
			next: (result) => {
				this.rows.update((current) => (append ? [...current, ...result.games] : result.games));
				this.hasMore.set(result.hasMore);
				this.loading.set(false);
				this.searched.set(true);
			},
			error: (err: Error) => {
				this.loading.set(false);
				this.searched.set(true);
				this.notify.error(err.message);
			},
		});
	}
}
