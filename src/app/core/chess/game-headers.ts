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
}

export const NO_GAME_HEADERS: GameHeaders = {};

const UNKNOWN_TAG = /^[?*.\s-]*$/;

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
	};
}

/** Converts PGN's YYYY.MM.DD into the day-first form the header shows. */
export function formatGameDate(date: string | undefined): string {
	if (!date) return '';
	const [year, month, day] = date.split('.');
	return [day, month, year].filter((part) => part && !part.includes('?')).join('.');
}
