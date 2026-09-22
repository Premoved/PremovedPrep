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
	name: string;
	archiveGames: number;
}

interface ResultGame {
	white: string;
	whiteFideId: number | null;
	whiteFideName: string | null;
	black: string;
	blackFideId: number | null;
	blackFideName: string | null;
	result: string;
	date: string | null;
	year: number | null;
	event: string | null;
	eco: string | null;
}

const API = 'https://api.premovedprep.com';
const SITE = 'https://premovedprep.com';

// Matches the HAVING clause in migration V20, which decides what the sitemap offers.
const MIN_GAMES_TO_INDEX = 5;

const PAGE_SIZE = 100;

export const onRequestGet: PagesFunction = async (context) => {
	const requestedSlug = String(context.params.slug ?? '');
	const fideId = idFromSlug(requestedSlug);
	if (fideId === null) {
		return notFound();
	}

	const url = new URL(context.request.url);
	const requested = url.searchParams.get('color');
	const color: 'w' | 'b' = requested === 'b' ? 'b' : 'w';

	const profile = await fetchJson<PlayerProfile>(`${API}/api/search/player/${fideId}`);
	if (!profile) {
		return notFound();
	}

	const name = profile.name;
	const slug = canonicalSlug(name, profile.fideId);

	if (requestedSlug !== slug) {
		const target = new URL(`/search/opponent/${slug}`, url);
		target.search = url.search;
		return new Response(null, {
			status: 301,
			headers: {
				location: target.toString(),
				// Edge cache only: a player's canonical name can change, moving this redirect's target.
				'cache-control': 'public, max-age=0, s-maxage=86400',
			},
		});
	}

	const games = await fetchGames(fideId, color);

	const canonical = `${SITE}/search/opponent/${slug}`;
	const count = `${profile.archiveGames} game${profile.archiveGames === 1 ? '' : 's'}`;
	const title = `${name} - chess games and preparation - PremovedPrep`;
	const description =
		`${count} by ${name} in the PremovedPrep archive: an all-in-one chess tool for analysis, ` +
		`exploring database games, studying opponents and building repertoires.`;

	const shell = await context.env.ASSETS.fetch(new Request(new URL('/index.html', context.request.url).toString()));
	if (!shell.ok) {
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
		.on('app-root', {
			element(element) {
				element.setInnerContent(body, { html: true });
			},
		})
		.transform(shell);

	return new Response(rewritten.body, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'strict-origin-when-cross-origin',
		},
	});
};

// Only the trailing digits matter; the words in front can vary (old spelling, no spelling) and still resolve.
function idFromSlug(slug: string): number | null {
	const match = /(\d+)$/.exec(slug);
	if (!match) {
		return null;
	}
	const id = Number(match[1]);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Twin of `slug` in functions/sitemap-opponents.xml.ts; keep both in sync or canonicals diverge.
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

function extraHead(profile: PlayerProfile, canonical: string, title: string, description: string): string {
	const robots =
		profile.archiveGames >= MIN_GAMES_TO_INDEX ? '' : '<meta name="robots" content="noindex, follow">';

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

function prerendered(name: string, count: string, color: 'w' | 'b', games: ResultGame[]): string {
	const side = color === 'w' ? 'as White' : 'as Black';

	const rows = games
		.map((game) => {
			const opponent = opponentCell(game, color);
			const white = color === 'w' ? esc(game.white) : opponent;
			const black = color === 'w' ? opponent : esc(game.black);
			return `<tr><td>${white}</td><td>${black}</td>` +
				`<td class="c">${esc(game.result || '*')}</td><td class="c">${esc(game.eco ?? '')}</td>` +
				`<td>${esc(game.event ?? '')}</td>` +
				`<td class="c">${esc(game.date ?? (game.year ? String(game.year) : ''))}</td></tr>`;
		})
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

// Link text is the PGN's spelling; the link itself uses the `player` table's spelling, since
// every /search/opponent URL is built from that table and would otherwise redirect once more.
function opponentCell(game: ResultGame, color: 'w' | 'b'): string {
	const name = color === 'w' ? game.black : game.white;
	const fideId = color === 'w' ? game.blackFideId : game.whiteFideId;
	const fideName = color === 'w' ? game.blackFideName : game.whiteFideName;

	const text = esc(name ?? '');
	if (!fideId || !fideName) {
		return text;
	}
	return `<a href="/search/opponent/${canonicalSlug(fideName, fideId)}">${text}</a>`;
}

// All fields come from ingested PGN/DB content and are untrusted; escape before inlining as HTML.
function esc(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
