/**
 * The address of a player's public page, built the same way the Cloudflare function builds it.
 *
 * Twin of `canonicalSlug` in functions/player/[slug].ts and functions/players.ts. The id is the
 * trailing number, so the words in front of it may disagree with the server's spelling without
 * breaking anything - the page resolves on the id and then declares its own canonical URL. If one
 * of the three changes, change the others.
 */
export function playerPagePath(name: string, fideId: number): string {
	const words = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `/player/${words ? `${words}-${fideId}` : fideId}`;
}
