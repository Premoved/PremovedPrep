/**
 * The generated half of the sitemap: one URL per player worth a page.
 *
 * /sitemap-players.xml is an index, and /sitemap-players.xml?page=N is one file of it. The format
 * allows 50,000 URLs per file, which is also the page size the API serves, so the two limits are
 * the same number in both places on purpose.
 *
 * Which players appear is decided in the database, by the `player_indexable` materialized view
 * (migration V20): those with at least five games in the archive. A page for somebody with one
 * game has a name on it and nothing else, and thousands of those are a liability rather than an
 * asset - so they are not offered here, and the page itself asks not to be indexed.
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

interface IndexPage {
	total: number;
	page: number;
	size: number;
	players: { fideId: number; name: string; games: number }[];
}

const API = 'https://api.premovedprep.com';
const SITE = 'https://premovedprep.com';
const PER_FILE = 50_000;

export const onRequestGet: PagesFunction = async (context) => {
	const url = new URL(context.request.url);
	const page = Number(url.searchParams.get('page'));

	const data = await fetchIndex(Number.isInteger(page) && page > 0 ? page : 0);
	if (!data) {
		/**
		 * 503 rather than an empty sitemap. An empty one is a statement - "these pages no longer
		 * exist" - and a crawler acts on it; a 503 is understood as "ask again later".
		 */
		return new Response('Sitemap temporarily unavailable', { status: 503 });
	}

	const body = url.searchParams.has('page') ? urlSet(data) : index(data.total);

	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			/** The view behind it is rebuilt once a night. */
			'cache-control': 'public, max-age=3600, s-maxage=86400',
		},
	});
};

async function fetchIndex(page: number): Promise<IndexPage | null> {
	try {
		const response = await fetch(`${API}/api/players/indexable?page=${page}&size=${PER_FILE}`, {
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

/** Without ?page, this file is a list of the files that hold the URLs. */
function index(total: number): string {
	const files = Math.max(1, Math.ceil(total / PER_FILE));
	const entries: string[] = [];
	for (let page = 0; page < files; page++) {
		entries.push(`\t<sitemap><loc>${SITE}/sitemap-players.xml?page=${page}</loc></sitemap>`);
	}
	return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</sitemapindex>
`;
}

function urlSet(data: IndexPage): string {
	const entries = data.players.map((player) => {
		/**
		 * priority is a hint, not a promise, and a flat 0.5 everywhere tells a crawler nothing. More
		 * games means a page with more on it, so it is worth reaching first.
		 */
		const priority = player.games >= 100 ? '0.8' : player.games >= 20 ? '0.6' : '0.4';
		return `\t<url><loc>${SITE}/player/${slug(player.name, player.fideId)}</loc><priority>${priority}</priority></url>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
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
