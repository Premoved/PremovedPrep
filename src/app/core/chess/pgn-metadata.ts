import { ItemShape, ItemType } from '../models/collection.model';

/**
 * Everything the collection list shows about an entry, worked out from the entry itself.
 *
 * This is the port of what the backend's PgnDocument and CollectionService.fieldsFor used to do on
 * the way in: read a PGN's tag pairs, count its mainline, and fill the columns the table sorts and
 * draws by. It moved here because those columns are the moves - "Carlsen, Nakamura, 1-0, 2024,
 * Wijk aan Zee" is not metadata about a game, it is the game's identity - and a server that held
 * them would be a server that had only encrypted the part nobody was looking at.
 *
 * It is deliberately the same logic and not a smaller one. A user who sorted a folder by White last
 * week must see the same order this week, and "approximately the old behaviour" is not something
 * anyone can check. The two places it knowingly differs are marked below.
 */

/** A game's tag pairs, by tag name. */
export type PgnTags = Readonly<Record<string, string>>;

/** One game out of a file: its own text, its tags, and how long its mainline is. */
export interface PgnGame {
	readonly pgn: string;
	readonly tags: PgnTags;
	readonly plyCount: number;
}

/** The fields the list draws, in the shape the components already expect. */
export interface DerivedFields {
	readonly title: string | null;
	readonly author: string | null;
	readonly white: string | null;
	readonly whiteElo: number | null;
	readonly black: string | null;
	readonly blackElo: number | null;
	/** A PGN token, or null for a row that was never played. Not the same as '*'. */
	readonly result: string | null;
	readonly event: string | null;
	/** ISO date, or null when the source tag was partial. `year` is set either way. */
	readonly date: string | null;
	readonly year: number | null;
	readonly eco: string | null;
	readonly plyCount: number;
	readonly startFen: string | null;
}

const TAG_PAIR = /^\s*\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*]\s*$/;

/** PGN's ways of writing 'nobody'. */
const UNNAMED = new Set(['nn', 'n.n.', 'n.n', 'unknown', 'unknown player', 'anonymous']);

const STANDARD_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Splits a file into games.
 *
 * Two things end a game and begin the next, and a real file needs both: a tag pair appearing after
 * movetext has been seen, and a tag pair appearing after the tag roster was closed by a blank line.
 * Exporters disagree about which they emit, so both are honoured.
 */
export function splitPgn(text: string): PgnGame[] {
	const games: PgnGame[] = [];
	let block: string[] = [];

	let seenMovetext = false;
	let inTags = false;
	let tagsClosed = false;

	const flush = (): void => {
		const joined = block.join('\n').trim();
		if (joined.length > 0) {
			games.push(parsePgn(joined));
		}
	};

	for (const line of strip(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
		const isTag = TAG_PAIR.test(line);

		if (isTag && (seenMovetext || tagsClosed)) {
			flush();
			block = [];
			seenMovetext = false;
			tagsClosed = false;
		}

		if (isTag) {
			inTags = true;
		} else if (line.trim().length === 0) {
			tagsClosed = tagsClosed || inTags;
		} else {
			seenMovetext = true;
			inTags = false;
		}
		block.push(line);
	}
	flush();

	return games;
}

export function parsePgn(text: string): PgnGame {
	const pgn = strip(text);
	const tags: Record<string, string> = {};

	for (const line of pgn.split(/\r?\n/)) {
		const match = TAG_PAIR.exec(line);
		if (match) {
			tags[match[1]] = unescapeTag(match[2]);
		}
	}

	return { pgn: pgn.trim(), tags, plyCount: mainlineSan(pgn).length };
}

/**
 * The fields for one entry.
 *
 * `title` and `author` are what the person typed, when they typed anything; the Event and Annotator
 * tags are the fallbacks, exactly as before. Which of the two row shapes this is decides whether the
 * players or the title occupy the first two columns - see V2's note on collection_item.
 */
export function deriveFields(
	type: ItemType,
	game: PgnGame,
	title?: string | null,
	author?: string | null,
): DerivedFields {
	const startFen = startFenFor(type, game);
	const annotator = blankToNull(author ?? tag(game, 'Annotator'));

	if (shapeOf(type) === 'DOCUMENT') {
		return {
			title: blankToNull(title ?? tag(game, 'Event')),
			author: annotator,
			white: null,
			whiteElo: null,
			black: null,
			blackElo: null,
			result: null,
			event: null,
			date: null,
			year: null,
			eco: ecoFor(game),
			plyCount: game.plyCount,
			startFen,
		};
	}

	const dateTag = tag(game, 'Date');
	const isoDate = parseDate(dateTag);

	return {
		title: null,
		author: annotator,
		white: tag(game, 'White'),
		whiteElo: intTag(game, 'WhiteElo'),
		black: tag(game, 'Black'),
		blackElo: intTag(game, 'BlackElo'),
		result: resultToken(tag(game, 'Result')),
		event: tag(game, 'Event'),
		date: isoDate,
		year: isoDate !== null ? Number(isoDate.slice(0, 4)) : parseYear(dateTag),
		eco: ecoFor(game),
		plyCount: game.plyCount,
		startFen,
	};
}

/**
 * Which type an imported game should be, given the shelf it is landing on. The same rule the
 * importer used: a game with two named players is a played game, and everything else is theory.
 */
export function importTypeFor(kind: 'LIBRARY' | 'REPERTOIRE', game: PgnGame): ItemType {
	const played = isNamed(tag(game, 'White')) && isNamed(tag(game, 'Black'));

	if (kind === 'REPERTOIRE') {
		return played ? 'MODEL_GAME' : 'MAIN_LINE';
	}
	if (played) {
		return 'GAME';
	}
	return tag(game, 'FEN') !== null ? 'STUDY' : 'ANALYSIS';
}

/**
 * What an entry becomes when it moves to the other shelf. The backend used to decide this; it needs
 * the starting position, which it can no longer see, so the decision travels with the request.
 */
export function convertTypeTo(kind: 'LIBRARY' | 'REPERTOIRE', type: ItemType, startFen: string | null): ItemType {
	if (accepts(kind, type)) {
		return type;
	}
	switch (type) {
		case 'GAME':
			return 'MODEL_GAME';
		case 'MODEL_GAME':
			return 'GAME';
		case 'ANALYSIS':
		case 'STUDY':
			return 'MAIN_LINE';
		case 'MAIN_LINE':
			return startFen !== null ? 'STUDY' : 'ANALYSIS';
	}
}

export function accepts(kind: 'LIBRARY' | 'REPERTOIRE', type: ItemType): boolean {
	return kind === 'LIBRARY'
		? type === 'ANALYSIS' || type === 'STUDY' || type === 'GAME'
		: type === 'MAIN_LINE' || type === 'MODEL_GAME';
}

export function shapeOf(type: ItemType): ItemShape {
	return type === 'GAME' || type === 'MODEL_GAME' ? 'GAME' : 'DOCUMENT';
}

/**
 * The mainline as SAN tokens, approximately: enough to count half-moves.
 *
 * Approximate on purpose, and the same approximation the backend made - stripping comments,
 * variations and NAGs with regular expressions rather than replaying the game on a board. Replaying
 * is what the analysis board does when it actually opens a file; doing it for every entry in a
 * folder just to print a number in a column would cost a chess engine's worth of work per list.
 */
export function mainlineSan(pgn: string): string[] {
	let text = pgn
		.replace(/\{[^}]*}/g, ' ')
		.replace(/;[^\n]*/g, ' ')
		.replace(/^[ \t]*\[[^\]]*][ \t]*$/gm, ' ');

	text = stripVariations(text);

	text = text
		.replace(/\$\d+/g, ' ')
		.replace(/\d+\s*\.(\.\.)?/g, ' ')
		.replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ')
		.replace(/[?!]+/g, '');

	const moves: string[] = [];
	for (const token of text.trim().split(/\s+/)) {
		/** A half-move always contains a destination square or is a castle. */
		if (/^[OoO0](-[OoO0]){1,2}[+#]?$/.test(token) || /^[A-Za-z][A-Za-z0-9=+#-]*\d[A-Za-z0-9=+#]*$/.test(token)) {
			moves.push(token);
		}
	}
	return moves;
}

/**
 * The opening code, from the file's own tag and nowhere else.
 *
 * THIS IS A DELIBERATE LOSS, AND THE ONE WORTH ARGUING ABOUT
 *
 * The backend used to classify a line it had no tag for by asking the public archive which opening
 * those moves are. That answer was good - better than a shipped table, because it came from real
 * games - and it cost sending the first thirty half-moves of the line to the server. Those thirty
 * half-moves are the preparation. There is no version of "encrypted, except the opening" that means
 * anything, so the lookup is gone and an untagged line is shown without a code.
 *
 * Most files carry [ECO]: anything exported by ChessBase, Lichess, chess.com or SCID does. What is
 * left uncovered is a line typed in from scratch, and the honest fix for that is a classification
 * table shipped with the application, which is a separate piece of work and not a reason to keep
 * sending moves upstairs in the meantime.
 */
function ecoFor(game: PgnGame): string | null {
	const tagged = tag(game, 'ECO');
	return tagged === null ? null : tagged.slice(0, 3);
}

/** Honours what ck_item_start_fen used to: only a STUDY must carry a starting position. */
export function startFenFor(type: ItemType, game: PgnGame): string | null {
	const fen = tag(game, 'FEN');

	if (type === 'ANALYSIS') {
		return null;
	}
	if (type === 'STUDY') {
		return fen ?? STANDARD_START;
	}
	return fen;
}

export function tag(game: PgnGame, name: string): string | null {
	const value = game.tags[name];
	if (value === undefined || value.trim().length === 0) {
		return null;
	}
	/** '?' is PGN's own 'unknown'. */
	const trimmed = value.trim();
	return trimmed === '?' ? null : trimmed;
}

function intTag(game: PgnGame, name: string): number | null {
	const value = tag(game, name);
	if (value === null) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

/** Mirrors GameResultCode: the four tokens, and null for anything else. */
function resultToken(value: string | null): string | null {
	switch (value) {
		case '1-0':
		case '0-1':
		case '1/2-1/2':
			return value;
		case '*':
			return '*';
		default:
			return null;
	}
}

function parseDate(value: string | null): string | null {
	if (value === null || value.length < 10 || value.includes('?')) {
		return null;
	}
	const iso = value.slice(0, 10).replace(/\./g, '-');
	return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : null;
}

function parseYear(value: string | null): number | null {
	if (value === null || value.length < 4) {
		return null;
	}
	const year = Number.parseInt(value.slice(0, 4), 10);
	return year > 1000 && year < 3000 ? year : null;
}

function isNamed(name: string | null): boolean {
	if (name === null || name.trim().length === 0) {
		return false;
	}
	const folded = name.trim().toLowerCase();
	return !UNNAMED.has(folded) && /\p{L}/u.test(folded);
}

function stripVariations(text: string): string {
	let out = '';
	let depth = 0;

	for (const character of text) {
		if (character === '(') {
			depth++;
		} else if (character === ')') {
			/** An unbalanced ')' is a broken file, not a reason to go negative. */
			depth = Math.max(0, depth - 1);
		} else if (depth === 0) {
			out += character;
		}
	}
	return out;
}

/** PGN escapes only \" and \\ inside a tag value. */
function unescapeTag(value: string): string {
	return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Removes the byte order mark a Windows exporter leaves at the top.
 *
 * Written as an escape rather than the character itself: a U+FEFF sitting in the source is invisible
 * to whoever reads this next, and is the kind of thing a copy and paste loses without saying so.
 */
function strip(pgn: string): string {
	return pgn.includes('\uFEFF') ? pgn.replace(/\uFEFF/g, '') : pgn;
}

function blankToNull(value: string | null | undefined): string | null {
	return value === null || value === undefined || value.trim().length === 0 ? null : value.trim();
}
