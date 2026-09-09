import { AfterViewInit, ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SearchColor } from '../../core/models/search.model';
import { AdvancedSearchComponent } from './advanced-search/advanced-search.component';
import { OpponentSearchComponent } from './opponent-search/opponent-search.component';

export type SearchTab = 'opponent' | 'advanced';

@Component({
	selector: 'app-search-page',
	standalone: true,
	imports: [OpponentSearchComponent, AdvancedSearchComponent],
	templateUrl: './search-page.component.html',
	styleUrl: './search-page.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPageComponent implements AfterViewInit {
	private readonly route = inject(ActivatedRoute);

	private readonly opponentSearch = viewChild(OpponentSearchComponent);

	readonly tab = signal<SearchTab>('opponent');

	readonly tabs: readonly { id: SearchTab; label: string }[] = [
		{ id: 'opponent', label: 'Search opponent' },
		{ id: 'advanced', label: 'Advanced search' },
	];

	/**
	 * `/search?opponent=<fideId>&color=b` opens the page already searching.
	 *
	 * Read once, after the view exists, rather than subscribed: this is an entry point, not a state
	 * the page keeps in the URL. Reacting to every parameter change would fight the user the moment
	 * they searched for somebody else.
	 */
	ngAfterViewInit(): void {
		const params = this.route.snapshot.queryParamMap;
		const opponent = Number(params.get('opponent'));
		if (!Number.isInteger(opponent) || opponent <= 0) {
			return;
		}
		const colour = params.get('color');
		const color: SearchColor | null = colour === 'w' || colour === 'b' ? colour : null;

		this.tab.set('opponent');
		this.opponentSearch()?.openFor(opponent, color);
	}

	select(tab: SearchTab): void {
		this.tab.set(tab);
	}
}
