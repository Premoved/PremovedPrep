import { DOCUMENT, inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

const SITE = 'PremovedPrep';
const ORIGIN = 'https://premovedprep.com';

const FALLBACK_DESCRIPTION =
	'A chess analysis tool for tournament preparation, building organized repertoires, studying opponents and exploring database games.';

/**
 * Keeps the title, the description and the canonical link in step with the route.
 *
 * A single-page application loads index.html once. Without this, every route reports the title and
 * the canonical URL of the home page: to a search engine the site is one page, and to a person the
 * browser tab says "PremovedPrep" whatever they are looking at.
 *
 * The text comes from route data, so a route declares its own description next to its component
 * rather than in a table somewhere else that drifts.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	private readonly title = inject(Title);
	private readonly meta = inject(Meta);
	private readonly document = inject(DOCUMENT);

	start(): void {
		this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
			const data = this.deepest().snapshot.data;
			this.apply(
				typeof data['title'] === 'string' ? data['title'] : null,
				typeof data['description'] === 'string' ? data['description'] : null,
			);
		});
	}

	/**
	 * For a page whose subject is only known once a request has answered - the opponent search at
	 * /search/opponent/<slug>, which has to fetch the player before it can name them. The function
	 * that served the HTML already wrote these tags; this is what keeps them there after Angular has
	 * replaced the page, which is the version a rendering crawler reads.
	 *
	 * Applied now and forgotten at the next navigation, which reapplies the route's own data, so it
	 * cannot leak onto another page.
	 */
	describe(pageTitle: string, description: string, canonicalPath?: string): void {
		this.apply(pageTitle, description, canonicalPath);
	}

	private apply(pageTitle: string | null, description: string | null, canonicalPath?: string): void {
		/** "Database search - PremovedPrep", and the bare name on the home page. */
		const full = pageTitle ? `${pageTitle} - ${SITE}` : SITE;
		const text = description ?? FALLBACK_DESCRIPTION;

		this.title.setTitle(full);
		this.meta.updateTag({ name: 'description', content: text });
		this.meta.updateTag({ property: 'og:title', content: full });
		this.meta.updateTag({ property: 'og:description', content: text });
		this.meta.updateTag({ name: 'twitter:title', content: full });
		this.meta.updateTag({ name: 'twitter:description', content: text });

		/**
		 * Query parameters are dropped on purpose. /search/opponent/x and the same URL with ?color=b
		 * are one page with a toggle flipped; declaring them as two would split whatever either earns.
		 *
		 * A caller may pass the path instead, which is how a player's page declares the server's
		 * spelling of their name as canonical rather than whichever spelling was followed here.
		 */
		const canonical = ORIGIN + (canonicalPath ?? this.router.url.split('?')[0].split('#')[0]);
		this.meta.updateTag({ property: 'og:url', content: canonical });

		let link = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
		if (!link) {
			link = this.document.createElement('link');
			link.setAttribute('rel', 'canonical');
			this.document.head.appendChild(link);
		}
		link.setAttribute('href', canonical);
	}

	/** The innermost activated route, which is the one whose data describes the page. */
	private deepest(): ActivatedRoute {
		let route = this.route;
		while (route.firstChild) {
			route = route.firstChild;
		}
		return route;
	}
}
