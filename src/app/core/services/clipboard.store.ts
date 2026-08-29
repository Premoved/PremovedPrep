import { Injectable, computed, signal } from '@angular/core';

export type ClipboardScope = 'COLLECTIONS' | 'ITEMS';

export interface ClipboardContents {
	readonly scope: ClipboardScope;
	/** True for Ctrl+C. False for Ctrl+X, where the originals are moved rather than duplicated. */
	readonly copy: boolean;
	readonly ids: readonly number[];
	readonly label: string;
}

/** The application's own clipboard, for Ctrl+X / Ctrl+C / Ctrl+V. */
@Injectable({ providedIn: 'root' })
export class ClipboardStore {
	private readonly _contents = signal<ClipboardContents | null>(null);

	readonly contents = this._contents.asReadonly();
	readonly isEmpty = computed(() => this._contents() === null);

	put(scope: ClipboardScope, ids: readonly number[], copy: boolean, label: string): void {
		if (ids.length === 0) {
			return;
		}
		this._contents.set({ scope, copy, ids: [...ids], label });
	}

	take(scope: ClipboardScope): ClipboardContents | null {
		const contents = this._contents();
		return contents && contents.scope === scope ? contents : null;
	}

	consumed(): void {
		if (this._contents()?.copy === false) {
			this._contents.set(null);
		}
	}

	clear(): void {
		this._contents.set(null);
	}
}
