/**
 * The address a player is searched at: /search/opponent/magnus-carlsen-1503014
 *
 * One URL per player, and it is the search page itself rather than a page about them - which is
 * also the URL a search engine indexes, so somebody arriving from one lands inside the tool with
 * that player already loaded.
 *
 * Twin of `canonicalSlug` in functions/search/opponent/[slug].ts and `slug` in
 * functions/sitemap-opponents.xml.ts. The id is the trailing number, so the words in front of it
 * may disagree with the server's spelling without breaking anything - the page resolves on the id
 * and then declares its own canonical URL. If one of the three changes, change the others.
 */
export function opponentSearchPath(name: string, fideId: number): string {
	const words = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `/search/opponent/${words ? `${words}-${fideId}` : fideId}`;
}

/** The id a slug carries, or null when it carries none. Mirrors the function's own reading. */
export function fideIdFromSlug(slug: string): number | null {
	const match = /(\d+)$/.exec(slug);
	if (!match) {
		return null;
	}
	const id = Number(match[1]);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}
