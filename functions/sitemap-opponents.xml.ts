/**
 * The generated half of the sitemap: one URL per player the archive knows well.
 *
 * WHY IT IS SHORT
 *
 * It used to offer every player with five games or more - tens of thousands of URLs, across two
 * files, because the format allows 50,000 in one. Google's answer was to register all of them and
 * crawl almost none: "Discovered - currently not indexed" against the whole list. Nothing was
 * rejected on its merits, because nothing was fetched. A sitemap states that a URL exists, not that
 * it is worth the request, and a very long one from a domain with no history reads as the former.
 *
 * So it now offers the best-known players only, and the number lives in the backend - see
 * IndexablePlayerRepository.OFFERED, which is the same 5,000 this file asks for. One file, no index
 * above it, which is also what the sitemap protocol wants: /sitemap.xml is already an index, and an
 * index may not list another index.
 *
 * The players left out are not hidden and not noindex. Their pages are served exactly as before,
 * and a crawler reaches them by following an opponent's name out of a game table on a page that is
 * listed here. That is a link from a real page rather than a line in a file, which is the stronger
 * signal of the two - and it is also how the archive genuinely connects: by who played whom.
 *
 * Which players qualify at all is decided in the database, by the `player_indexable` materialized
 * view (migration V20): those with at least five games. Below that the page has a name and little
 * else, and the page itself asks not to be indexed.
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

/** Twin of IndexablePlayerRepository.OFFERED. The backend caps it too; asking for more is harmless. */
const OFFERED = 5_000;

export const onRequestGet: PagesFunction = async () => {
	const data = await fetchOffered();
	if (!data) {
		/**
		 * 503 rather than an empty sitemap. An empty one is a statement - "these pages no longer
		 * exist" - and a crawler acts on it; a 503 is understood as "ask again later".
		 */
		return new Response('Sitemap temporarily unavailable', { status: 503 });
	}

	return new Response(urlSet(data), {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			/** The view behind it is rebuilt once a night. */
			'cache-control': 'public, max-age=3600, s-maxage=86400',
		},
	});
};

async function fetchOffered(): Promise<IndexPage | null> {
	try {
		const response = await fetch(`${API}/api/players/indexable?page=0&size=${OFFERED}`, {
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

function urlSet(data: IndexPage): string {
	const entries = data.players.map((player) => {
		/**
		 * priority is a hint, not a promise, and a flat 0.5 everywhere tells a crawler nothing. More
		 * games means a page with more on it, so it is worth reaching first.
		 */
		const priority = player.games >= 100 ? '0.8' : player.games >= 20 ? '0.6' : '0.4';
		return `\t<url><loc>${SITE}/search/opponent/${slug(player.name, player.fideId)}</loc><priority>${priority}</priority></url>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

/** Twin of canonicalSlug in search/opponent/[slug].ts. If one changes, change the other. */
function slug(name: string, fideId: number): string {
	const words = name
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return words ? `${words}-${fideId}` : String(fideId);
}
