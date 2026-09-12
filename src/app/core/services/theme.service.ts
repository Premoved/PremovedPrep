import { Injectable, signal } from '@angular/core';

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'premovedprep.theme';

/**
 * Light or dark, and which one a visitor gets.
 *
 * Light is the default everywhere it is not overridden: it is the palette `:root` carries in
 * styles.css, so the first paint - before any of this has run - is already light. Dark is a choice,
 * made here or carried in from an account, and never inferred from the operating system.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
	readonly theme = signal<ThemeName>('light');

	init(): void {
		const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
		this.apply(stored === 'dark' ? 'dark' : 'light');
	}

	toggle(): void {
		this.apply(this.theme() === 'dark' ? 'light' : 'dark');
	}

	set(theme: ThemeName): void {
		this.apply(theme);
	}

	/**
	 * Back to light, and the stored choice forgotten.
	 *
	 * Called when a session ends. The theme on screen belonged to the account that just left, and
	 * this is one browser: without this, the next person to open the site - or the next account to
	 * sign in on this machine - inherits it, having chosen nothing. That is how a first visit ends up
	 * dark.
	 */
	reset(): void {
		this.apply('light');
	}

	private apply(theme: ThemeName): void {
		this.theme.set(theme);
		document.body.classList.remove('light', 'dark');
		document.body.classList.add(theme);
		localStorage.setItem(STORAGE_KEY, theme);
	}
}
