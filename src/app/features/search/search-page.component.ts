import { AfterViewInit, ChangeDetectionStrategy, Component, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SearchColor } from '../../core/models/search.model';
import { SeoService } from '../../core/seo/seo.service';
import { fideIdFromSlug, opponentSearchPath } from '../../core/seo/opponent-page';
import { AdvancedSearchComponent } from './advanced-search/advanced-search.component';
import { OpponentSearchComponent, ResultPanel } from './opponent-search/opponent-search.component';

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
	private readonly seo = inject(SeoService);

	private readonly opponentSearch = viewChild(OpponentSearchComponent);

	readonly tab = signal<SearchTab>('opponent');

	readonly tabs: readonly { id: SearchTab; label: string }[] = [
		{ id: 'opponent', label: 'Search opponent' },
		{ id: 'advanced', label: 'Advanced search' },
	];

	constructor() {
		// Re-sets the SSR title/description post-hydration so crawlers reading the rendered page match.
		// The address follows the opponent on screen (see OpponentSearchComponent.writeUrl), so the
		// title and canonical link follow it too.
		effect(() => {
			const player = this.opponentSearch()?.profile();
			if (!player) {
				return;
			}
			const name = player.name;
			const games = `${player.archiveGames} game${player.archiveGames === 1 ? '' : 's'}`;
			this.seo.describe(
				`${name} - chess games and preparation`,
				`${games} by ${name} in the PremovedPrep archive: an all-in-one chess tool for analysis, ` +
					`exploring database games, studying opponents and building repertoires.`,
				opponentSearchPath(name, player.fideId),
			);
		});
	}

	// Read once, not reactive: an entry point, so a later search doesn't fight the URL on param changes.
	ngAfterViewInit(): void {
		const slug = this.route.snapshot.paramMap.get('slug');
		const fideId = slug === null ? null : fideIdFromSlug(slug);
		if (fideId === null) {
			return;
		}

		const query = this.route.snapshot.queryParamMap;
		const colour = query.get('color');
		const color: SearchColor | null = colour === 'w' || colour === 'b' ? colour : null;
		const from = query.get('from');
		const view = query.get('view');
		const panel: ResultPanel | null = view === 'tree' || view === 'report' ? view : null;

		this.tab.set('opponent');
		this.opponentSearch()?.openFor(fideId, color, from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null, panel);
	}

	select(tab: SearchTab): void {
		this.tab.set(tab);
	}
}
