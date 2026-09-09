/**
 * A crawlable index of the player pages: /players, /players?page=1, ...
 *
 * WHY THIS EXISTS
 *
 * A sitemap tells a crawler which URLs exist. It does not tell it they matter, and a page nothing
 * links to is an orphan: crawled late, revisited rarely, ranked low. Sixty thousand orphans is what
 * the player pages were the moment they were generated.
 *
 * A link from inside the application would not have fixed it. That is an Angular route, rendered by
 * JavaScript, and a link only a renderer can see is a link a crawler mostly does not follow - the
 * exact dependency the player pages were written to avoid. The path has to be made of pages that
 * are already HTML, which is what this is: one page of five hundred links, with a next and a
 * previous, so a crawler that enters once can walk the whole set without executing anything.
 */

/**
 * Declared here rather than pulled from @cloudflare/workers-types - see the note in
 * player/[slug].ts. The three functions in this repository share the same four lines.
 */
type PagesContext = {
	request: Request;
	params: Record<string, string | string[]>;
};
type PagesFunction = (context: PagesContext) => Response | Promise<Response>;

interface IndexPage {
	total: number;
	page: number;
	size: number;
	players: { fideId: number; name: string; games: number }[];
}

const API = 'https://api.premovedprep.com';
const SITE = 'https://premovedprep.com';
const PER_PAGE = 500;

export const onRequestGet: PagesFunction = async (context) => {
	const url = new URL(context.request.url);
	const requested = Number(url.searchParams.get('page'));
	const page = Number.isInteger(requested) && requested > 0 ? requested : 0;

	const data = await fetchPage(page);
	if (!data) {
		return new Response('Player index temporarily unavailable', { status: 503 });
	}
	if (data.players.length === 0 && page > 0) {
		return new Response('Not found', { status: 404 });
	}

	const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));

	return new Response(render(data, page, pages), {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'public, max-age=600, s-maxage=86400',
			'content-security-policy':
				"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
			'x-content-type-options': 'nosniff',
			'x-frame-options': 'DENY',
			'referrer-policy': 'strict-origin-when-cross-origin',
		},
	});
};

async function fetchPage(page: number): Promise<IndexPage | null> {
	try {
		const response = await fetch(`${API}/api/players/indexable?page=${page}&size=${PER_PAGE}`, {
			headers: { accept: 'application/json' },
		});
		if (!response.ok) {
			return null;
		}
		return (await response.json()) as IndexPage;
	} catch {
		return null;
	}
}

function render(data: IndexPage, page: number, pages: number): string {
	const canonical = page === 0 ? `${SITE}/players` : `${SITE}/players?page=${page}`;
	const heading = page === 0 ? 'Players in the archive' : `Players in the archive - page ${page + 1}`;
	const description = `Every FIDE player with games in the PremovedPrep archive: ${data.total.toLocaleString(
		'en',
	)} of them, ordered by how many games they have. Open a player to see their games, openings by colour, and prepare against them.`;

	const items = data.players
		.map(
			(player) =>
				`<li><a href="${SITE}/player/${slug(player.name, player.fideId)}">${esc(player.name)}</a> <span class="n">${player.games}</span></li>`,
		)
		.join('\n');

	const nav: string[] = [];
	if (page > 0) {
		nav.push(`<a rel="prev" href="${SITE}/players${page - 1 === 0 ? '' : `?page=${page - 1}`}">Previous</a>`);
	}
	if (page + 1 < pages) {
		nav.push(`<a rel="next" href="${SITE}/players?page=${page + 1}">Next</a>`);
	}

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)} | PremovedPrep</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(heading)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<link rel="icon" type="image/svg+xml" href="${SITE}/favicon.svg">
<style>
:root { color-scheme: light dark; }
body { margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 60rem; font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
p.lead { color: #666; margin: 0 0 1.5rem; }
ul { list-style: none; padding: 0; margin: 0; columns: 3 16rem; column-gap: 2rem; }
li { break-inside: avoid; padding: .15rem 0; }
.n { color: #999; font-size: .8rem; font-variant-numeric: tabular-nums; }
nav { margin-top: 2rem; display: flex; gap: 1.5rem; }
a { color: #2f6fb0; }
footer { margin-top: 2.5rem; color: #666; font-size: .9rem; }
</style>
</head>
<body>
<h1>${esc(heading)}</h1>
<p class="lead">${data.total.toLocaleString('en')} players have at least five games in the archive. The number after a name is how many.</p>

<ul>
${items}
</ul>

<nav>${nav.join('\n')}</nav>

<footer>
<p>Page ${page + 1} of ${pages}. <a href="${SITE}/search">Search the archive</a> · <a href="${SITE}/home">PremovedPrep</a></p>
</footer>
</body>
</html>
`;
}

/** Twin of canonicalSlug in player/[slug].ts. If one changes, change the other. */
function slug(name: string, fideId: number): string {
	const words = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return words ? `${words}-${fideId}` : String(fideId);
}

function esc(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
