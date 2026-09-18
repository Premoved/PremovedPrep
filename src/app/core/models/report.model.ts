/**
 * The Advanced Report.
 *
 * Everything below the first type is built in the browser now. The server used to lay the opponent's
 * games over the user's repertoire and send the finished tree; it cannot read the repertoire any
 * more, so it sends the games - which are public archive rows and always were - and the overlay
 * happens where the repertoire is readable. See core/report/advanced-report.ts.
 *
 * The shapes are unchanged, which is the point: the screen that draws a report did not have to learn
 * that any of this moved.
 */

/**
 * One of the opponent's games, as the archive stores it. The only shape here that crosses the wire.
 *
 * `movesSan` is the importer's own normalised movetext - no comments, no variations - which is why
 * the report's reader is simpler than the one that reads a user's own file.
 */
export interface ArchiveGame {
	readonly id: number;
	readonly white: string | null;
	readonly whiteElo: number | null;
	readonly black: string | null;
	readonly blackElo: number | null;
	readonly result: string | null;
	readonly year: number | null;
	readonly event: string | null;
	readonly movesSan: string | null;
}

/** What GET /api/report/opponent-games answers. */
export interface OpponentGames {
	readonly fideId: number;
	readonly opponentColor: 'w' | 'b';
	readonly gamesRead: number;
	/** True when the archive had more than the cap and the rest were not read. */
	readonly truncated: boolean;
	readonly games: readonly ArchiveGame[];
}

export type ReportPointKind = 'OVERLAP' | 'DEVIATION';

export interface ReportGame {
	readonly id: number;
	readonly white: string | null;
	readonly whiteElo: number | null;
	readonly black: string | null;
	readonly blackElo: number | null;
	readonly result: string | null;
	readonly year: number | null;
	readonly event: string | null;
	readonly ply: number;
}

export interface ReportMove {
	readonly uci: string;
	readonly san: string;
	/** How many of the opponent's games played it. `sample` is capped; this is the real count. */
	readonly games: number;
	readonly sample: readonly ReportGame[];
}

export interface ReportBookFile {
	readonly itemId: number;
	readonly title: string;
}

export interface ReportPoint {
	readonly kind: ReportPointKind;
	readonly index: number;
	readonly line: readonly string[];
	readonly moves: readonly ReportMove[];
	readonly book: readonly ReportBookFile[];
}

export interface ReportNode {
	readonly uci: string | null;
	readonly san: string | null;
	readonly games: number;
	readonly point: ReportPoint | null;
	readonly children: readonly ReportNode[];
}

export interface AdvancedReport {
	readonly fideId: number;
	readonly opponentColor: 'w' | 'b';
	readonly repertoireColor: 'w' | 'b';
	readonly repertoireFiles: number;
	readonly gamesRead: number;
	readonly truncated: boolean;
	readonly overlaps: number;
	readonly deviations: number;
	readonly root: ReportNode;
}
