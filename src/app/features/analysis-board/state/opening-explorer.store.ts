import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { OpeningTree, OpeningTreeMove, EMPTY_OPENING_TREE } from '../../../core/models/opening-tree.model';
import { OpponentScope } from '../../../core/models/search.model';
import { OpeningExplorerService } from '../../../core/services/opening-explorer.service';
import { SearchApiService } from '../../../core/services/search-api.service';
import { MoveTreeStore } from './move-tree.store';

export type ExplorerStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Opening tree for the position on the board, built from the archive. */
@Injectable()
export class OpeningExplorerStore {
	private readonly api = inject(OpeningExplorerService);
	private readonly search = inject(SearchApiService);
	private readonly tree = inject(MoveTreeStore);

	private readonly _scope = signal<OpponentScope | null>(null);
	readonly scope = this._scope.asReadonly();

	private readonly _active = signal(false);
	private readonly _status = signal<ExplorerStatus>('idle');
	private readonly _data = signal<OpeningTree>(EMPTY_OPENING_TREE);
	private readonly _error = signal<string | null>(null);

	readonly status = this._status.asReadonly();
	readonly error = this._error.asReadonly();

	readonly moves = computed<readonly OpeningTreeMove[]>(() => this._data().moves);
	readonly totals = computed(() => this._data());

	readonly isEmpty = computed(() => this._status() === 'ready' && this._data().moves.length === 0);

	/** Positions already fetched, so stepping back and forth does not re-query. */
	private readonly cache = new Map<string, OpeningTree>();
	private static readonly CACHE_LIMIT = 200;

	/** Monotonic; only the newest request may write the signals above. */
	private requestId = 0;

	constructor() {
		effect(() => {
			/** Read first and return early: a closed tab does not track the position. */
			if (!this._active()) {
				return;
			}
			this.load(this.tree.currentNode().fen);
		});
	}

	setActive(active: boolean): void {
		this._active.set(active);
	}

	setScope(scope: OpponentScope | null): void {
		if (sameScope(this._scope(), scope)) {
			return;
		}
		this.cache.clear();
		this._scope.set(scope);
	}

	private load(fen: string): void {
		const cached = this.cache.get(fen);
		if (cached) {
			this.requestId++;
			this._data.set(cached);
			this._error.set(null);
			this._status.set('ready');
			return;
		}

		const id = ++this.requestId;
		this._status.set('loading');
		this._error.set(null);

		const scope = this._scope();
		const request$ = scope ? this.search.opponentOpeningTree(scope, fen) : this.api.openingTree(fen);

		request$.subscribe({
			next: (tree) => {
				this.remember(fen, tree);
				if (id !== this.requestId) return;
				this._data.set(tree);
				this._status.set('ready');
			},
			error: () => {
				if (id !== this.requestId) return;
				this._data.set(EMPTY_OPENING_TREE);
				this._error.set('The game database is not reachable.');
				this._status.set('error');
			},
		});
	}

	private remember(fen: string, tree: OpeningTree): void {
		if (this.cache.size >= OpeningExplorerStore.CACHE_LIMIT) {
			const oldest = this.cache.keys().next();
			if (!oldest.done) {
				this.cache.delete(oldest.value);
			}
		}
		this.cache.set(fen, tree);
	}
}

function sameScope(a: OpponentScope | null, b: OpponentScope | null): boolean {
	if (a === null || b === null) {
		return a === b;
	}
	return a.fideId === b.fideId && a.color === b.color && a.from === b.from && a.to === b.to;
}
