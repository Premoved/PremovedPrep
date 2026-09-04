import { Injectable } from '@angular/core';

/**
 * Which draft this browser tab owns. sessionStorage is per tab and is restored along with the tab
 * when a browser reopens its windows, so a tab keeps its analysis and a new tab starts a new one.
 */
const TAB_KEY = 'premovedprep.board';

/** Every draft, by tab id. localStorage, so closing the browser does not take them. */
const DRAFTS_KEY = 'premovedprep.drafts';

/** A closed tab leaves its draft behind and nothing can ask it to tidy up, so the oldest go. */
const MAX_DRAFTS = 10;

/** Roughly a very long game with variations. Past this the tab keeps working, unsaved. */
const MAX_PGN_BYTES = 200_000;

export interface AnalysisDraft {
	readonly pgn: string;
	/** The cursor, spelled the way ?line= spells it. */
	readonly line: readonly string[];
	readonly isStudy: boolean;
	/** The collection entry this analysis came from, when it came from one. */
	readonly itemId: number | null;
	readonly savedAt: number;
}

type Drafts = Record<string, AnalysisDraft>;

/**
 * The board's work in progress, kept in the browser rather than on the account.
 *
 * This is not a save: nothing here reaches the server, and an entry opened from a collection stays
 * dirty until it is actually saved. It exists so that closing a tab, or the whole browser, is not
 * the same as throwing the analysis away.
 */
@Injectable({ providedIn: 'root' })
export class AnalysisDraftStore {
	private id: string | null = null;

	read(): AnalysisDraft | null {
		const id = this.tabId();
		return id ? (this.all()[id] ?? null) : null;
	}

	write(draft: AnalysisDraft): void {
		const id = this.tabId();
		if (!id || draft.pgn.length > MAX_PGN_BYTES) {
			return;
		}
		this.persist(this.trim({ ...this.all(), [id]: draft }));
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
			/** A browser that refuses storage still gets a board; it just will not be here tomorrow. */
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

	private persist(all: Drafts): void {
		try {
			localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
		} catch {
			/** Quota, or private mode. Losing the draft is bad; losing the board would be worse. */
		}
	}
}
