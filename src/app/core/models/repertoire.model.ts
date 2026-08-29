/** Where a repertoire's model games join its theory. */

export interface RepertoireGame {
	readonly itemId: number;
	readonly white: string | null;
	readonly whiteElo: number | null;
	readonly black: string | null;
	readonly blackElo: number | null;
	readonly result: string | null;
	readonly event: string | null;
	readonly date: string | null;
	readonly year: number | null;
	readonly eco: string | null;
	readonly plyCount: number;
	/** The half-move the citation stands at, and what the board opens on. */
	readonly ply: number;
}

export interface RepertoireBranch {
	readonly uci: string;
	readonly games: readonly RepertoireGame[];
	readonly children: readonly RepertoireBranch[];
}

export interface RepertoireAttachment {
	readonly path: readonly string[];
	readonly games: readonly RepertoireGame[];
	readonly branches: readonly RepertoireBranch[];
}

export interface RepertoireTree {
	readonly itemId: number;
	readonly collectionId: number;
	readonly color: 'w' | 'b' | null;
	readonly modelGames: number;
	/** How many model games reached this trunk. Lower than modelGames when a game shares no position. */
	readonly linked: number;
	readonly attachments: readonly RepertoireAttachment[];
}
