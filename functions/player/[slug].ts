/**
 * A public, crawlable page for one FIDE player: /player/magnus-carlsen-1503014
 *
 * WHY THIS EXISTS AS A FUNCTION AND NOT AS A ROUTE IN THE APPLICATION
 *
 * The application is a single-page application. Every route it serves is the same empty shell plus
 * JavaScript, and the content appears only after that JavaScript has run. Google will render
 * JavaScript, but it queues it, and it does not do it at the scale of tens of thousands of pages
 * for a domain it has no history with. Every other crawler - Bing, the social cards, the model
 * crawlers - mostly does not do it at all.
 *
 * This function answers with the finished HTML, on the first request, with no JavaScript at all.
 * That is the whole trick behind every chess database that appears when somebody searches a
 * player's name.
 *
 * It runs on a request, not on a schedule - the part of Cloudflare Workers that is reliable here.
 *
 * The page is for a person as much as for a crawler: it ends in one link, into the application,
 * with this player already loaded in the opponent search.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT SHOW
 *
 * Nothing sourced from the FIDE rating list: no title, no federation, no standard, rapid or blitz
 * rating, no world rank, no birth year, and no Elo on the game rows either - a PGN that arrives
 * without a rating has one filled in from `player_rating`, and this page cannot tell those apart.
 *
 * Lichess releases its exports under CC0, which permits publication of any kind. FIDE's download
 * page carries a blanket reservation - "No part of this site may be reproduced ... without the
 * written permission of FIDE" - and, in the EU, a database right protects re-utilisation of a
 * substantial part of a database regardless of whether the facts inside it are copyrightable.
 * Sixty-two thousand generated pages is a substantial part by any reading.
 *
 * Using that data inside the application, for the people using it, is the ordinary use every chess
 * tool makes of it. Publishing it as an indexed corpus is not the same act, and only the second one
 * is given up here. What is left is what the archive itself is: names, results, openings, dates.
 */

/**
 * Declared here rather than pulled from @cloudflare/workers-types.
 *
 * These two files are the only thing in this repository that runs on Cloudflare rather than in a
 * browser, and the shape they need is four lines. A dependency for four lines is a dependency to
 * update, to audit and to explain, and it would be the only one the Angular build has no use for.
 */
type PagesContext = {
	request: Request;
	params: Record<string, string | string[]>;
};
type PagesFunction = (context: PagesContext) => Response | Promise<Response>;

interface PlayerProfile {
	fideId: number;
	name: string;
	/** The spelling the games themselves carry, which is the one this page prefers. */
	archiveName: string | null;
	archiveGames: number;
}

interface RelatedPlayer {
	fideId: number;
	name: string;
	games: number;
}

interface ResultGame {
	id: number;
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
 * Below this many games a page has a name and nothing else, which is what search engines call thin
 * content: ignored at best, and held against the rest of the domain at worst. The page is still
 * served - somebody may have followed a link - but it asks not to be indexed.
 *
 * Same number as the HAVING clause in migration V20, which decides what the sitemap offers.
 */
const MIN_GAMES_TO_INDEX = 5;

export const onRequestGet: PagesFunction = async (context) => {
	const slug = String(context.params.slug ?? '');
	const fideId = idFromSlug(slug);
	if (fideId === null) {
		return notFound();
	}

	const profile = await fetchJson<PlayerProfile>(`${API}/api/search/player/${fideId}`);
	if (!profile) {
		return notFound();
	}

	/**
	 * Both colours, because a player's page is about the player, not about one side of their board.
	 * Two subrequests rather than one: the API answers per colour, and rewriting it for this page
	 * would put a search-engine concern into the application's own contract.
	 */
	const [asWhite, asBlack, related] = await Promise.all([
		fetchGames(fideId, 'w'),
		fetchGames(fideId, 'b'),
		fetchRelated(fideId),
	]);
	const games = [...asWhite, ...asBlack].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 12);

	const canonical = `${SITE}/player/${canonicalSlug(profile.name, profile.fideId)}`;

	/** A redirect would be cleaner, but a crawler follows it and drops what it already fetched. */
	const html = render(profile, games, related, canonical);

	return new Response(html, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			/**
			 * Cached hard at the edge. A crawler works through thousands of these, and the underlying
			 * facts move once a month when FIDE publishes.
			 */
			'cache-control': 'public, max-age=600, s-maxage=86400',
			/** This page has no scripts of its own, so it can refuse all of them. */
			'content-security-policy':
				"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
			'x-content-type-options': 'nosniff',
			'x-frame-options': 'DENY',
			'referrer-policy': 'strict-origin-when-cross-origin',
		},
	});
};

/**
 * The id is the trailing number, so the words in front of it are free to change: a player's name
 * gains a spelling, the slug changes, and every old link still resolves - to the same page, which
 * then declares the new URL as its canonical one.
 */
function idFromSlug(slug: string): number | null {
	const match = /(\d+)$/.exec(slug);
	if (!match) {
		return null;
	}
	const id = Number(match[1]);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Twin of the same function in sitemap-players.xml.ts. If one changes, change the other. */
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

/**
 * The players linked at the foot of the page.
 *
 * Not decoration: without them each of these pages is an island, reachable only from a sitemap, and
 * a crawler treats a page nothing links to as a page nobody thinks matters.
 */
async function fetchRelated(fideId: number): Promise<RelatedPlayer[]> {
	/**
	 * Without a federation, which would come from the FIDE list. The endpoint's fallback - the
	 * players with the most games - is the neighbour relation left, and it is the better one for a
	 * crawler anyway: it points at the pages with the most on them.
	 */
	return (await fetchJson<RelatedPlayer[]>(`${API}/api/players/indexable/related?fideId=${fideId}&limit=8`)) ?? [];
}

async function fetchGames(fideId: number, color: 'w' | 'b'): Promise<ResultGame[]> {
	const page = await fetchJson<{ games: ResultGame[] }>(
		`${API}/api/search/opponent?fideId=${fideId}&color=${color}&size=12`,
	);
	return page?.games ?? [];
}

function notFound(): Response {
	return new Response('Not found', {
		status: 404,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
	});
}

function render(profile: PlayerProfile, games: ResultGame[], related: RelatedPlayer[], canonical: string): string {
	/** The archive spelling first: it comes from the game scores, which are the CC0 half. */
	const name = esc(profile.archiveName ?? profile.name);
	const indexable = profile.archiveGames >= MIN_GAMES_TO_INDEX;
	const count = `${profile.archiveGames} game${profile.archiveGames === 1 ? '' : 's'}`;

	const description = `${count} by ${name} in the PremovedPrep archive: full game scores, openings by colour, opponents and results - and one click to prepare against them.`;

	const rows = games
		.map(
			(game) => `<tr>
			<td>${esc(game.white)}</td>
			<td>${esc(game.black)}</td>
			<td class="mid">${esc(game.result ?? '*')}</td>
			<td class="mid">${esc(game.eco ?? '')}</td>
			<td>${esc(game.event ?? '')}</td>
			<td class="mid">${esc(game.date ?? (game.year ? String(game.year) : ''))}</td>
		</tr>`,
		)
		.join('\n');

	/**
	 * Schema.org Person, with nothing in it that came from the rating list: a name, and the FIDE id
	 * that is already in the URL and is what makes two players of the same name distinguishable.
	 */
	const jsonLd = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'Person',
		name: profile.archiveName ?? profile.name,
		jobTitle: 'Chess player',
		identifier: { '@type': 'PropertyValue', propertyID: 'FIDE ID', value: String(profile.fideId) },
		url: canonical,
	});

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} - chess games and preparation | PremovedPrep</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${indexable ? '' : '<meta name="robots" content="noindex, follow">\n'}<meta property="og:type" content="profile">
<meta property="og:title" content="${name} - chess games and preparation">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${SITE}/social-banner.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="${SITE}/favicon.svg">
<script type="application/ld+json">${jsonLd}</script>
<style>
:root { color-scheme: light dark; }
body { margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 60rem; font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
h1 { font-size: 1.7rem; margin: 0 0 .25rem; }
.facts { color: #666; margin: 0 0 1.5rem; }
.cta { display: inline-block; margin: 0 .5rem 1.5rem 0; padding: .7rem 1.1rem; border-radius: 8px; background: #2f6fb0; color: #fff; text-decoration: none; font-weight: 600; }
.cta.secondary { background: transparent; color: #2f6fb0; border: 1px solid #2f6fb0; }
table { border-collapse: collapse; width: 100%; font-size: .92rem; }
th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #ddd; }
td.mid { text-align: center; white-space: nowrap; }
p.related { line-height: 2; }
footer { margin-top: 2.5rem; color: #666; font-size: .9rem; }
a { color: #2f6fb0; }
</style>
</head>
<body>
<h1>${name}</h1>
<p class="facts">${count} in the PremovedPrep archive</p>

<a class="cta" href="${SITE}/search?opponent=${profile.fideId}">Prepare against ${name}</a>
<a class="cta secondary" href="${SITE}/search?opponent=${profile.fideId}&amp;color=b">Their games as Black</a>

${
	games.length
		? `<h2>Recent games</h2>
<table>
<thead><tr><th>White</th><th>Black</th><th class="mid">Result</th><th class="mid">ECO</th><th>Event</th><th class="mid">Date</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
		: '<p>No games by this player are in the archive yet.</p>'
}

${
	related.length
		? `<h2>Other players in the archive</h2>
<p class="related">${related
				.map((other) => `<a href="${SITE}/player/${canonicalSlug(other.name, other.fideId)}">${esc(other.name)}</a>`)
				.join(' &middot; ')}</p>`
		: ''
}

<footer>
<p><a href="${SITE}/players">All players in the archive</a> &middot; <a href="${SITE}/search">Search the archive</a></p>
<p>Game scores come from public broadcast archives released under CC0. Open the full archive, the
opening tree by colour and the analysis board on
<a href="${SITE}/search?opponent=${profile.fideId}">PremovedPrep</a>.</p>
</footer>
</body>
</html>
`;
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
