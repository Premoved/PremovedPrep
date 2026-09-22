import { Injectable } from '@angular/core';

// Per-tab id in sessionStorage; DRAFTS_KEY (localStorage) holds every tab's draft, keyed by this id.
const TAB_KEY = 'premovedprep.board';

const DRAFTS_KEY = 'premovedprep.drafts';

const MAX_DRAFTS = 10;

// Past this the tab keeps working, unsaved to storage.
const MAX_PGN_BYTES = 200_000;

export interface AnalysisDraft {
	readonly pgn: string;
	readonly line: readonly string[];
	readonly isStudy: boolean;
	readonly itemId: number | null;
	readonly savedAt: number;
}

type Drafts = Record<string, AnalysisDraft>;

// Not a save: nothing here reaches the server. Only guards against losing work on tab/browser close.
@Injectable({ providedIn: 'root' })
export class AnalysisDraftStore {
	private id: string | null = null;

	read(): AnalysisDraft | null {
		const id = this.tabId();
		return id ? (this.all()[id] ?? null) : null;
	}

	/** Returns whether the draft was actually persisted; false means the work could still be lost. */
	write(draft: AnalysisDraft): boolean {
		const id = this.tabId();
		if (!id || draft.pgn.length > MAX_PGN_BYTES) {
			return false;
		}
		return this.persist(this.trim({ ...this.all(), [id]: draft }));
	}

	clear(): void {
		const id = this.tabId();
		if (!id) {
			return;
		}
		const all = this.all();
		if (!(id in all)) {
			return;
		}
		delete all[id];
		this.persist(all);
	}

	private tabId(): string | null {
		if (this.id !== null) {
			return this.id;
		}
		try {
			const existing = sessionStorage.getItem(TAB_KEY);
			this.id = existing ?? crypto.randomUUID();
			if (existing === null) {
				sessionStorage.setItem(TAB_KEY, this.id);
			}
			return this.id;
		} catch {
			// A browser that refuses storage still gets a board; it just will not be here tomorrow.
			return null;
		}
	}

	private all(): Drafts {
		try {
			const raw = localStorage.getItem(DRAFTS_KEY);
			const parsed: unknown = raw ? JSON.parse(raw) : null;
			return typeof parsed === 'object' && parsed !== null ? (parsed as Drafts) : {};
		} catch {
			return {};
		}
	}

	private trim(all: Drafts): Drafts {
		const entries = Object.entries(all);
		if (entries.length <= MAX_DRAFTS) {
			return all;
		}
		entries.sort(([, a], [, b]) => b.savedAt - a.savedAt);
		return Object.fromEntries(entries.slice(0, MAX_DRAFTS));
	}

	private persist(all: Drafts): boolean {
		try {
			localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
			return true;
		} catch {
			// Quota, or private mode. Losing the draft is bad; losing the board would be worse.
			return false;
		}
	}
}
