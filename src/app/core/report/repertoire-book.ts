import { ItemDetail } from '../models/collection.model';
import { PgnTreeNode, STANDARD_EPD, parsePgnTree } from '../chess/pgn-tree';

/**
 * Everything one colour of a user's repertoire says, merged into a single tree.
 *
 * The port of the backend's RepertoireBook, moved here for the same reason everything else moved:
 * it is built out of the trunks' moves, and the moves are sealed now. It is built from entries the
 * browser has already decrypted for the collection list, so the work is a replay over PGNs in hand
 * rather than a second trip to the database.
 */

/** Which of the user's trunk files a position came from. */
export interface BookSource {
	readonly itemId: number;
	readonly title: string;
}

/** A position in the merged repertoire. */
export interface BookNode {
	readonly parent: BookNode | null;
	readonly uci: string | null;
	readonly san: string | null;
	readonly fen: string;
	readonly ply: number;
	/** Keyed by UCI, in insertion order - the order the files contributed them. */
	readonly children: Map<string, BookNode>;
	readonly sources: BookSource[];
}

export interface Book {
	readonly root: BookNode;
	/** How many trunk files went into it. */
	readonly files: number;
}

/** How deep the book is read, in half-moves. */
const MAX_PLY = 60;

const DEFAULT_TITLE = 'Main line';

/**
 * Merges every trunk of one colour into one tree.
 *
 * `trunks` is the MAIN_LINE entries of every repertoire collection of that colour, decrypted. A
 * trunk that does not begin from the opening array is skipped: nothing in a set-up position is
 * reachable from move one, so nothing in it could ever be matched against a game that was played.
 * That is the rule the server used, kept exactly - a repertoire that quietly started counting
 * set-up studies would change every report anyone had already read.
 */
export function buildBook(trunks: readonly ItemDetail[]): Book {
	const root: BookNode = {
		parent: null,
		uci: null,
		san: null,
		fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		ply: 0,
		children: new Map(),
		sources: [],
	};

	let files = 0;

	for (const trunk of trunks) {
		const parsed = parsePgnTree(trunk.pgn, trunk.startFen);
		if (parsed.epd !== STANDARD_EPD) {
			continue;
		}

		files++;
		merge(root, parsed, { itemId: trunk.id, title: titleOf(trunk) });
	}

	return { root, files };
}

export function isEmptyBook(book: Book): boolean {
	return book.root.children.size === 0;
}

export function bookPathOf(node: BookNode): string[] {
	const path: string[] = [];
	for (let current: BookNode | null = node; current?.uci != null; current = current.parent) {
		path.unshift(current.uci);
	}
	return path;
}

/** Copies one file's tree into the merged one. */
function merge(into: BookNode, from: PgnTreeNode, source: BookSource): void {
	if (!into.sources.some((existing) => existing.itemId === source.itemId)) {
		into.sources.push(source);
	}
	if (into.ply >= MAX_PLY) {
		return;
	}

	for (const child of from.children) {
		if (child.uci === null) {
			continue;
		}

		let merged = into.children.get(child.uci);
		if (merged === undefined) {
			merged = {
				parent: into,
				uci: child.uci,
				san: child.san,
				fen: child.fen,
				ply: into.ply + 1,
				children: new Map(),
				sources: [],
			};
			into.children.set(child.uci, merged);
		}
		merge(merged, child, source);
	}
}

function titleOf(trunk: ItemDetail): string {
	const name = trunk.title?.trim();
	return name === undefined || name.length === 0 ? DEFAULT_TITLE : name;
}
