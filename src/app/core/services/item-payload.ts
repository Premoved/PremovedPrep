/**
 * What is actually inside a sealed entry.
 *
 * WHY SO LITTLE
 *
 * Everything the list shows - the players, the result, the date, the event, the ECO code, the ply
 * count, the starting position - is derived from the PGN, and it was derived from the PGN on the
 * server too. Sealing them alongside the moves would store the same facts twice and give an attacker
 * a second, shorter thing to guess at. So the payload is the document and the two fields that are
 * genuinely not in it: the title and the annotator, which a person may set to something the tag
 * pairs do not say.
 *
 * `v` is a version and not decoration. The day this shape grows a field, an entry written before
 * that day still has to open, and a reader that checks a number can say so instead of quietly
 * reading undefined.
 */

export interface ItemPayload {
	readonly pgn: string;
	readonly title: string | null;
	readonly author: string | null;
}

interface StoredPayload {
	readonly v: number;
	readonly pgn: string;
	readonly title?: string | null;
	readonly author?: string | null;
}

const VERSION = 1;

export function writePayload(payload: ItemPayload): string {
	const stored: StoredPayload = { v: VERSION, pgn: payload.pgn };
	return JSON.stringify(
		payload.title === null && payload.author === null
			? stored
			: { ...stored, title: payload.title, author: payload.author },
	);
}

export function readPayload(text: string): ItemPayload {
	let parsed: StoredPayload;
	try {
		parsed = JSON.parse(text) as StoredPayload;
	} catch {
		throw new Error('This entry is stored in a form this version cannot read');
	}

	if (typeof parsed?.pgn !== 'string' || typeof parsed.v !== 'number' || parsed.v > VERSION) {
		throw new Error('This entry is stored in a form this version cannot read');
	}

	return { pgn: parsed.pgn, title: parsed.title ?? null, author: parsed.author ?? null };
}

/**
 * The empty trunk every repertoire holds at least one of.
 *
 * It used to be a constant in CollectionService, written by the server when a library folder became
 * a repertoire. The server cannot write it any more - it would have to be sealed, and it has no key
 * - so the constant lives here and the browser sends it. Same text, different side of the wall.
 */
export const EMPTY_MAIN_LINE_PGN = `[Event "Main line"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "?"]
[Black "?"]
[Result "*"]

*
`;
