import { DEFAULT_FEN } from './fen.util';
import { GameHeaders } from './game-headers';

/** Composes a complete PGN file from what the board holds. */
export interface PgnFileOptions {
	readonly headers: GameHeaders;
	readonly startFen: string;
	readonly movetext: string;
	readonly title?: string | null;
	readonly annotator?: string | null;
}

const UNKNOWN_TEXT = '?';
const UNKNOWN_DATE = '????.??.??';
const UNFINISHED = '*';

export function composePgnFile(options: PgnFileOptions): string {
	const { headers, startFen, movetext, title, annotator } = options;

	const tags: [string, string][] = [
		['Event', headers.event || title || UNKNOWN_TEXT],
		['Site', headers.site || UNKNOWN_TEXT],
		['Date', headers.date || UNKNOWN_DATE],
		['Round', headers.round || UNKNOWN_TEXT],
		['White', headers.white || UNKNOWN_TEXT],
		['Black', headers.black || UNKNOWN_TEXT],
		['Result', headers.result || UNFINISHED],
	];

	pushIf(tags, 'WhiteElo', headers.whiteElo);
	pushIf(tags, 'BlackElo', headers.blackElo);
	pushIf(tags, 'ECO', headers.eco);
	pushIf(tags, 'TimeControl', headers.timeControl);
	pushIf(tags, 'Termination', headers.termination);
	pushIf(tags, 'Annotator', annotator || headers.annotator);

	if (startFen && startFen !== DEFAULT_FEN) {
		tags.push(['FEN', startFen]);
		tags.push(['SetUp', '1']);
	}

	const roster = tags.map(([name, value]) => `[${name} "${escapeTag(value)}"]`).join('\n');
	return `${roster}\n\n${movetext}\n`;
}

export function pgnFileName(headers: GameHeaders, title?: string | null): string {
	const players = headers.white && headers.black ? `${headers.white}-${headers.black}` : null;
	const name = title?.trim() || players || headers.event || 'analysis';

	return (
		name
			.normalize('NFKD')
			.replace(/[^\w\s-]/g, '')
			.trim()
			.replace(/\s+/g, '-')
			.slice(0, 60) || 'analysis'
	);
}

function pushIf(tags: [string, string][], name: string, value: string | undefined | null): void {
	if (value && value.trim().length > 0) {
		tags.push([name, value.trim()]);
	}
}

function escapeTag(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
