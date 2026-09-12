/**
 * The indexed entry point for one player: /search/opponent/magnus-carlsen-1503014
 *
 * WHAT THIS IS, AND WHAT IT REPLACED
 *
 * It used to be a page of its own, at /player/<slug>, rendered entirely by this function. That page
 * answered a search engine well and served the person badly: they landed on a summary and had to
 * click again to reach the thing they were looking for. It is gone, and the URLs it owned redirect
 * here.
 *
 * This is not a second page about a player. It is *the search page*, on its own URL, with that
 * player already in the box. Somebody arriving from a search engine lands inside the tool.
 *
 * WHY A FUNCTION IS STILL NEEDED
 *
 * The application is a single-page application: every route is the same empty shell plus
 * JavaScript, and the content appears only once that JavaScript has run. Google will render it,
 * but it queues the work, and it does not do it at the scale of tens of thousands of URLs for a
 * domain it has no history with. Bing and the model crawlers mostly do not do it at all.
 *
 * So this function fetches the shell, writes the title, description and canonical into it, and
 * puts the first page of results inside <app-root> before returning it. A crawler that runs no
 * JavaScript reads finished HTML. A browser reads the same HTML, shows it while the bundle loads,
 * and Angular then replaces it with the live page - which is the ordinary hydration handover, and
 * on a slow connection it means content appears sooner than the application does.
 *
 * HTMLRewriter rather than string surgery: the shell is built by Angular and minified, so its
 * attribute order and whitespace are not ours to predict.
 *
 * THE NAME
 *
 * `profile.name`, which is the `player` table's spelling and the one functions/sitemap-opponents.xml
 * builds its slugs from. The two have to be the same field or every URL in the sitemap declares a
 * canonical pointing somewhere else.
 *
 * WHAT THE PRE-RENDERED HTML DELIBERATELY LEAVES OUT
 *
 * Everything sourced from the FIDE rating list: title, federation, the three ratings, the world and
 * national ranks, and the Elo columns on the game rows - a PGN that arrives without a rating has
 * one filled in from `player_rating`, and this cannot tell those apart.
 *
 * The person still sees all of it, a moment later, rendered by the application. That is the
 * ordinary use every chess tool makes of the list. What is given up is the other thing: publishing
 * it as tens of thousands of crawlable documents. Lichess releases its exports under CC0, which
 * permits publication of any kind; FIDE's download page carries a blanket reservation, and in the
 * EU a database right protects re-utilisation of a substantial part regardless of whether the facts
 * inside it are copyrightable. Which route the data sits on does not enter into that test, so
 * moving the page here changed nothing about it. See OPERATIONS.md 9b.
 */

/**
 * Declared here rather than pulled from @cloudflare/workers-types.
 *
 * These files are the only thing in this repository that runs on Cloudflare rather than in a
 * browser, and the shape they need is a few lines. A dependency for a few lines is a dependency to
 * update, to audit and to explain, and it would be the only one the Angular build has no use for.
 */
type PagesContext = {
	request: Request;
	params: Record<string, string | string[]>;
	env: { ASSETS: { fetch(request: Request): Promise<Response> } };
};
type PagesFunction = (context: PagesContext) => Response | Promise<Response>;

interface RewriterElement {
	setAttribute(name: string, value: string): void;
	setInnerContent(content: string, options?: { html: boolean }): void;
	append(content: string, options?: { html: boolean }): void;
}
interface HtmlRewriter {
	on(selector: string, handlers: { element(element: RewriterElement): void }): HtmlRewriter;
	transform(response: Response): Response;
}
declare const HTMLRewriter: { new (): HtmlRewriter };

interface PlayerProfile {
	fideId: number;
	/**
	 * The player. Not `archiveName`, which sits next to it on the same DTO and is the name of the
	 * *archive* - it answers "Official Lichess Broadcasts", not "Carlsen, Magnus". Reading it as
	 * the player's spelling put the archive's name in the title, the canonical and the slug of
	 * every one of these URLs, against a sitemap built from this field.
	 */
	name: string;
	archiveGames: number;
}

interface ResultGame {
	white: string;
	black: string;
	result: string;
	date: string | null;
	year: number | null;
	event: string | null;
	eco: string | null;
}

const API = 'https://api.premovedprep.com';
const SITE = 'https://premovedprep.com';

/**
 * Below this many games the page has a name and little else, which is what search engines call thin
 * content: ignored at best, held against the rest of the domain at worst. It is still served -
 * somebody may have followed a link - but it asks not to be indexed.
 *
 * Same number as the HAVING clause in migration V20, which decides what the sitemap offers.
 */
const MIN_GAMES_TO_INDEX = 5;

/** What the application itself asks for on the first page, so the two agree. */
const PAGE_SIZE = 100;

export const onRequestGet: PagesFunction = async (context) => {
	const fideId = idFromSlug(String(context.params.slug ?? ''));
	if (fideId === null) {
		return notFound();
	}

	const requested = new URL(context.request.url).searchParams.get('color');
	/** White unless asked otherwise, which is the colour the component starts on. */
	const color: 'w' | 'b' = requested === 'b' ? 'b' : 'w';

	const profile = await fetchJson<PlayerProfile>(`${API}/api/search/player/${fideId}`);
	if (!profile) {
		return notFound();
	}

	const games = await fetchGames(fideId, color);

	/** The same field the sitemap builds its slugs from, so the canonical and the sitemap agree. */
	const name = profile.name;
	const canonical = `${SITE}/search/opponent/${canonicalSlug(name, profile.fideId)}`;
	const count = `${profile.archiveGames} game${profile.archiveGames === 1 ? '' : 's'}`;
	/**
	 * The same two strings SearchPageComponent sets once Angular has booted. They have to match: a
	 * crawler that runs no JavaScript reads this one, a crawler that does reads that one, and two
	 * different titles for one URL is the kind of drift nobody notices until it is in the index.
	 */
	const title = `${name} - chess games and preparation - PremovedPrep`;
	const description =
		`${count} by ${name} in the PremovedPrep archive: an all-in-one chess tool for analysis, ` +
		`exploring database games, studying opponents and building repertoires.`;

	const shell = await context.env.ASSETS.fetch(new Request(new URL('/index.html', context.request.url).toString()));
	if (!shell.ok) {
		/** The shell is the page. Without it there is nothing to answer with, and a 503 says so. */
		return new Response('Temporarily unavailable', { status: 503 });
	}

	const head = extraHead(profile, canonical, title, description);
	const body = prerendered(name, count, color, games);

	const rewritten = new HTMLRewriter()
		.on('title', {
			element(element) {
				element.setInnerContent(title);
			},
		})
		.on('meta[name="description"]', {
			element(element) {
				element.setAttribute('content', description);
			},
		})
		.on('meta[property="og:title"]', {
			element(element) {
				element.setAttribute('content', title);
			},
		})
		.on('meta[property="og:description"]', {
			element(element) {
				element.setAttribute('content', description);
			},
		})
		.on('meta[property="og:url"]', {
			element(element) {
				element.setAttribute('content', canonical);
			},
		})
		.on('meta[name="twitter:title"]', {
			element(element) {
				element.setAttribute('content', title);
			},
		})
		.on('meta[name="twitter:description"]', {
			element(element) {
				element.setAttribute('content', description);
			},
		})
		.on('link[rel="canonical"]', {
			element(element) {
				element.setAttribute('href', canonical);
			},
		})
		.on('head', {
			element(element) {
				element.append(head, { html: true });
			},
		})
		/** Angular clears this element when it boots, so what goes in is what a crawler reads. */
		.on('app-root', {
			element(element) {
				element.setInnerContent(body, { html: true });
			},
		})
		.transform(shell);

	return new Response(rewritten.body, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			/**
			 * Held at the edge, not in the browser. A crawler works through thousands of these; a person
			 * who has just been signed out by a deploy must not be served yesterday's shell, and the
			 * script tags inside it are the part that would go stale.
			 */
			'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'strict-origin-when-cross-origin',
		},
	});
};

/**
 * The id is the trailing number, so the words in front of it are free to change: a player's name
 * gains a spelling, the slug changes, and every old link still resolves - to the same page, which
 * then declares the new URL as its canonical one. It is also what keeps two players of the same
 * name apart, which a name alone cannot do.
 */
function idFromSlug(slug: string): number | null {
	const match = /(\d+)$/.exec(slug);
	if (!match) {
		return null;
	}
	const id = Number(match[1]);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Twin of `opponentSearchPath` in src/app/core/seo/opponent-page.ts. Change one, change the other. */
function canonicalSlug(name: string, fideId: number): string {
	const words = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return words ? `${words}-${fideId}` : String(fideId);
}

async function fetchJson<T>(url: string): Promise<T | null> {
	try {
		const response = await fetch(url, { headers: { accept: 'application/json' } });
		if (!response.ok) {
			return null;
		}
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

async function fetchGames(fideId: number, color: 'w' | 'b'): Promise<ResultGame[]> {
	const page = await fetchJson<{ games: ResultGame[] }>(
		`${API}/api/search/opponent?fideId=${fideId}&color=${color}&size=${PAGE_SIZE}`,
	);
	return page?.games ?? [];
}

function notFound(): Response {
	return new Response('Not found', {
		status: 404,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
	});
}

/** The tags the shell has no version of, appended rather than rewritten. */
function extraHead(profile: PlayerProfile, canonical: string, title: string, description: string): string {
	const robots =
		profile.archiveGames >= MIN_GAMES_TO_INDEX ? '' : '<meta name="robots" content="noindex, follow">';

	/**
	 * A search page about a person, which is what this is - not a profile of one. Nothing in it comes
	 * from the rating list: a name, and the FIDE id that is already in the URL.
	 */
	const jsonLd = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'WebPage',
		name: title,
		description,
		url: canonical,
		about: {
			'@type': 'Person',
			name: profile.name,
			jobTitle: 'Chess player',
			identifier: { '@type': 'PropertyValue', propertyID: 'FIDE ID', value: String(profile.fideId) },
		},
	});

	return `${robots}<script type="application/ld+json">${jsonLd.replace(/</g, '\\u003c')}</script>`;
}

/**
 * What sits inside <app-root> until the bundle takes over.
 *
 * Plain and readable rather than hidden: text a crawler is shown and a person is not is cloaking,
 * and this is the same content the application draws a second later.
 */
function prerendered(name: string, count: string, color: 'w' | 'b', games: ResultGame[]): string {
	const side = color === 'w' ? 'as White' : 'as Black';

	const rows = games
		.map(
			(game) => `<tr><td>${esc(game.white)}</td><td>${esc(game.black)}</td>` +
				`<td class="c">${esc(game.result || '*')}</td><td class="c">${esc(game.eco ?? '')}</td>` +
				`<td>${esc(game.event ?? '')}</td>` +
				`<td class="c">${esc(game.date ?? (game.year ? String(game.year) : ''))}</td></tr>`,
		)
		.join('');

	const table = games.length
		? `<table><thead><tr><th>White</th><th>Black</th><th class="c">Result</th><th class="c">ECO</th>` +
			`<th>Event</th><th class="c">Date</th></tr></thead><tbody>${rows}</tbody></table>`
		: '<p>No games by this player are in the archive yet.</p>';

	return `<div class="pp-pre">
<style>
.pp-pre{margin:0 auto;padding:2rem 1.25rem;max-width:60rem;font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.pp-pre h1{font-size:1.6rem;margin:0 0 .2rem}
.pp-pre p.f{color:#666;margin:0 0 1.25rem}
.pp-pre table{border-collapse:collapse;width:100%;font-size:.92rem}
.pp-pre th,.pp-pre td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #ddd}
.pp-pre td.c,.pp-pre th.c{text-align:center;white-space:nowrap}
</style>
<h1>${esc(name)} - chess games</h1>
<p class="f">${esc(count)} in the PremovedPrep archive. Games ${side}.</p>
${table}
<p><a href="${SITE}/search">Search the archive</a></p>
</div>`;
}

/** Every value here comes from a database that ingests other people's PGN files. Escape all of it. */
function esc(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
