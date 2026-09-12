import { AfterViewInit, ChangeDetectionStrategy, Component, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SearchColor } from '../../core/models/search.model';
import { SeoService } from '../../core/seo/seo.service';
import { fideIdFromSlug, opponentSearchPath } from '../../core/seo/opponent-page';
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
	private readonly seo = inject(SeoService);

	private readonly opponentSearch = viewChild(OpponentSearchComponent);

	readonly tab = signal<SearchTab>('opponent');

	readonly tabs: readonly { id: SearchTab; label: string }[] = [
		{ id: 'opponent', label: 'Search opponent' },
		{ id: 'advanced', label: 'Advanced search' },
	];

	/** The player this page was opened for, when it was opened at /search/opponent/<slug>. */
	private wanted: number | null = null;

	constructor() {
		/**
		 * The title of that URL is the player's name, and the name arrives with the profile rather
		 * than with the route. The function that served the HTML has already written it; this keeps it
		 * written once Angular has replaced the page, which is the version a rendering crawler reads.
		 *
		 * Only for the player the URL asked for. Searching for somebody else afterwards leaves the
		 * title alone, because the address bar still says whose page this is.
		 */
		effect(() => {
			const player = this.opponentSearch()?.profile();
			if (!player || player.fideId !== this.wanted) {
				return;
			}
			/** `archiveName` is the archive's own name - "Official Lichess Broadcasts" - not the player's. */
			const name = player.name;
			const games = `${player.archiveGames} game${player.archiveGames === 1 ? '' : 's'}`;
			/** Word for word what functions/search/opponent/[slug].ts served; SeoService appends the site. */
			this.seo.describe(
				`${name} - chess games and preparation`,
				`${games} by ${name} in the PremovedPrep archive: an all-in-one chess tool for analysis, ` +
					`exploring database games, studying opponents and building repertoires.`,
				opponentSearchPath(name, player.fideId),
			);
		});
	}

	/**
	 * `/search/opponent/<slug>` opens the page already searching, and `?color=b` starts it on the
	 * other side of the board.
	 *
	 * Read once, after the view exists, rather than subscribed: this is an entry point, not a state
	 * the page keeps in the URL. Reacting to every parameter change would fight the user the moment
	 * they searched for somebody else.
	 */
	ngAfterViewInit(): void {
		const slug = this.route.snapshot.paramMap.get('slug');
		const fideId = slug === null ? null : fideIdFromSlug(slug);
		if (fideId === null) {
			return;
		}

		const colour = this.route.snapshot.queryParamMap.get('color');
		const color: SearchColor | null = colour === 'w' || colour === 'b' ? colour : null;

		this.wanted = fideId;
		this.tab.set('opponent');
		this.opponentSearch()?.openFor(fideId, color);
	}

	select(tab: SearchTab): void {
		this.tab.set(tab);
	}
}
