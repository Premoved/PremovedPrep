import { Injectable, signal } from '@angular/core';

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'premovedprep.theme';

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

	private apply(theme: ThemeName): void {
		this.theme.set(theme);
		document.body.classList.remove('light', 'dark');
		document.body.classList.add(theme);
		localStorage.setItem(STORAGE_KEY, theme);
	}
}
