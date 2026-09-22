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

// Twin of IndexablePlayerRepository.OFFERED. The backend caps it too; asking for more is harmless.
const OFFERED = 5_000;

export const onRequestGet: PagesFunction = async () => {
	const data = await fetchOffered();
	if (!data) {
		// 503, not an empty sitemap: an empty one tells crawlers the pages are gone.
		return new Response('Sitemap temporarily unavailable', { status: 503 });
	}

	return new Response(urlSet(data), {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
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
		const priority = player.games >= 100 ? '0.8' : player.games >= 20 ? '0.6' : '0.4';
		return `\t<url><loc>${SITE}/search/opponent/${slug(player.name, player.fideId)}</loc><priority>${priority}</priority></url>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

// Twin of canonicalSlug in search/opponent/[slug].ts. If one changes, change the other.
function slug(name: string, fideId: number): string {
	const words = name
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return words ? `${words}-${fideId}` : String(fideId);
}
