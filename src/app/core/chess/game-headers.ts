export interface GameHeaders {
	readonly white?: string;
	readonly whiteElo?: string;
	readonly black?: string;
	readonly blackElo?: string;
	readonly result?: string;
	readonly eco?: string;
	readonly event?: string;
	readonly site?: string;
	readonly round?: string;
	readonly date?: string;
	readonly annotator?: string;
	readonly timeControl?: string;
	readonly termination?: string;
	readonly variant?: string;
	/**
	 * Every other tag the file carried. Kept so that copying or exporting gives back what came in:
	 * a reader that models thirteen tags would otherwise strip the rest without saying so.
	 */
	readonly extra?: Readonly<Record<string, string>>;
}

export const NO_GAME_HEADERS: GameHeaders = {};

const UNKNOWN_TAG = /^[?*.\s-]*$/;

/**
 * Tags this file owns. The thirteen it models, plus the three written from the position rather than
 * carried over - a stale FEN would turn a played game into a set-up one.
 */
const OWN_TAGS = new Set([
	'White',
	'WhiteElo',
	'Black',
	'BlackElo',
	'Result',
	'ECO',
	'Event',
	'Site',
	'Round',
	'Date',
	'Annotator',
	'TimeControl',
	'Termination',
	'Variant',
	'FEN',
	'SetUp',
	/** Derived from the movetext, which editing changes. */
	'PlyCount',
]);

export function hasGameHeaders(headers: GameHeaders): boolean {
	return Object.values(headers).some((value) => value !== undefined);
}

export function gameHeadersFromTags(tags: Readonly<Record<string, string>>): GameHeaders {
	const read = (name: string): string | undefined => {
		const raw = tags[name]?.trim();
		return raw && !UNKNOWN_TAG.test(raw) ? raw : undefined;
	};

	return {
		white: read('White'),
		whiteElo: read('WhiteElo'),
		black: read('Black'),
		blackElo: read('BlackElo'),
		result: read('Result'),
		eco: read('ECO'),
		event: read('Event'),
		site: read('Site'),
		round: read('Round'),
		date: read('Date'),
		annotator: read('Annotator'),
		timeControl: read('TimeControl'),
		termination: read('Termination'),
		variant: read('Variant'),
		extra: extraTags(tags),
	};
}

function extraTags(tags: Readonly<Record<string, string>>): Readonly<Record<string, string>> | undefined {
	const extra: Record<string, string> = {};
	for (const [name, value] of Object.entries(tags)) {
		const trimmed = value.trim();
		if (!OWN_TAGS.has(name) && trimmed.length > 0) {
			extra[name] = trimmed;
		}
	}
	return Object.keys(extra).length > 0 ? extra : undefined;
}

/** Converts PGN's YYYY.MM.DD into the day-first form the header shows. */
export function formatGameDate(date: string | undefined): string {
	if (!date) return '';
	const [year, month, day] = date.split('.');
	return [day, month, year].filter((part) => part && !part.includes('?')).join('.');
}
