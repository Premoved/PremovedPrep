import { Chess } from 'chess.js';
import { AdvancedReport, ArchiveGame, ReportGame, ReportMove, ReportNode, ReportPoint } from '../models/report.model';
import { Book, BookNode, bookPathOf } from './repertoire-book';
import { cleanSan } from '../chess/pgn-tree';

/**
 * The Advanced Report: one player's games laid over one colour of the user's repertoire.
 *
 * WHY IT IS HERE AND NOT ON THE SERVER
 *
 * The overlay needs two things at once - the opponent's games, which are public, and the user's
 * repertoire, which is not. The server used to have both because it could read the repertoire. Since
 * it cannot, the only place the two can meet is the browser: the server sends the games it was
 * always allowed to send, and the book is built here from entries this browser has decrypted.
 *
 * WHAT IT DOES
 *
 * Every game is replayed against the book. Each node the game passes through is counted. The first
 * move a game plays that the book has no answer for is a departure, and it is recorded on the node
 * it left from, with a handful of sample games. Which of the two kinds of departure it is depends on
 * whose move it was: a move OUR side plays that the book does not cover is an OVERLAP - the opponent
 * chose a line we also play - and a move THEIR side plays that we have nothing prepared for is a
 * DEVIATION.
 *
 * This is a line-for-line port of AdvancedReportService. The figures, the ordering and the names are
 * the ones it used, because a report that came out differently after this change would be a report
 * nobody could compare to the one they read last week.
 */

/** As deep as the book goes. */
const MAX_PLY = 60;

/** Games kept per departing move, newest first. */
const SAMPLE_GAMES = 5;

/** Prefix lengths retried when a game's movetext will not fully replay. */
const RETRY_PREFIXES = [40, 24, 16, 10, 6, 4, 2];

export function buildAdvancedReport(
	book: Book,
	games: readonly ArchiveGame[],
	fideId: number,
	opponentColor: 'w' | 'b',
	truncated: boolean,
): AdvancedReport {
	const ourColor = opponentColor === 'b' ? 'w' : 'b';
	const walk = new Walk(book, ourColor);

	for (const game of games) {
		walk.game(game);
	}

	const emit = new Emit(walk);
	const root = emit.node(book.root);

	return {
		fideId,
		opponentColor,
		repertoireColor: ourColor,
		repertoireFiles: book.files,
		gamesRead: walk.gamesRead,
		truncated,
		overlaps: emit.overlaps,
		deviations: emit.deviations,
		root,
	};
}

/** One departing move, and the games that played it. */
class Departure {
	games = 0;
	private readonly sample: ReportGame[] = [];

	constructor(
		readonly uci: string,
		readonly san: string,
	) {}

	add(game: ArchiveGame, ply: number): void {
		this.games++;
		this.sample.push({
			id: game.id,
			white: game.white,
			whiteElo: game.whiteElo,
			black: game.black,
			blackElo: game.blackElo,
			result: game.result,
			year: game.year,
			event: game.event,
			ply,
		});
	}

	toMove(): ReportMove {
		/** Newest first: what they played last year matters more. */
		const sorted = [...this.sample].sort((a, b) => {
			const byYear = (b.year ?? 0) - (a.year ?? 0);
			return byYear !== 0 ? byYear : b.id - a.id;
		});

		return { uci: this.uci, san: this.san, games: this.games, sample: sorted.slice(0, SAMPLE_GAMES) };
	}
}

class Walk {
	gamesRead = 0;

	readonly visits = new Map<BookNode, number>();
	readonly leaving = new Map<BookNode, Map<string, Departure>>();

	private readonly weAreWhite: boolean;

	constructor(
		private readonly book: Book,
		ourColor: 'w' | 'b',
	) {
		this.weAreWhite = ourColor === 'w';
	}

	game(game: ArchiveGame): void {
		this.gamesRead++;
		if (game.movesSan === null || game.movesSan.trim().length === 0) {
			return;
		}

		const san = sanMoves(game.movesSan);
		const moves = replay(san);
		if (moves === null) {
			return;
		}

		let node = this.book.root;
		this.visits.set(node, (this.visits.get(node) ?? 0) + 1);

		for (let ply = 0; ply < moves.length && ply < MAX_PLY; ply++) {
			const child = node.children.get(moves[ply]);

			if (child !== undefined) {
				node = child;
				this.visits.set(node, (this.visits.get(node) ?? 0) + 1);
				continue;
			}

			/** The book has nothing to say here: this is where the theory stops. */
			if (node.children.size > 0) {
				/** The SAN is the archive's own token, not something re-derived. */
				const label = ply < san.length ? san[ply] : moves[ply];

				let atNode = this.leaving.get(node);
				if (atNode === undefined) {
					atNode = new Map();
					this.leaving.set(node, atNode);
				}

				let departure = atNode.get(moves[ply]);
				if (departure === undefined) {
					departure = new Departure(moves[ply], label);
					atNode.set(moves[ply], departure);
				}
				departure.add(game, node.ply);
			}
			return;
		}
	}

	oursToMove(node: BookNode): boolean {
		return this.weAreWhite === (node.ply % 2 === 0);
	}
}

/** Emits the trunk: the book cut down to the nodes at least one game reached. */
class Emit {
	overlaps = 0;
	deviations = 0;

	constructor(private readonly walk: Walk) {}

	node(node: BookNode): ReportNode {
		const games = this.walk.visits.get(node) ?? 0;
		const point = this.point(node);

		const children: ReportNode[] = [];
		for (const child of node.children.values()) {
			if ((this.walk.visits.get(child) ?? 0) > 0) {
				children.push(this.node(child));
			}
		}

		return { uci: node.uci, san: node.san, games, point, children };
	}

	private point(node: BookNode): ReportPoint | null {
		const left = this.walk.leaving.get(node);
		if (left === undefined || left.size === 0) {
			return null;
		}

		const ours = this.walk.oursToMove(node);
		const kind = ours ? 'OVERLAP' : 'DEVIATION';
		const index = ours ? ++this.overlaps : ++this.deviations;

		/** Most played first. */
		const moves = [...left.values()].map((departure) => departure.toMove()).sort((a, b) => b.games - a.games);

		return {
			kind,
			index,
			line: bookPathOf(node),
			moves,
			book: node.sources.map((source) => ({ itemId: source.itemId, title: source.title })),
		};
	}
}

/**
 * The archive's movetext as SAN tokens: move numbers and the result dropped, nothing re-derived.
 *
 * `moves_san` is the importer's own normalised text, so this is deliberately simpler than the parser
 * that reads a user's file - there are no comments, variations or annotations in it to strip.
 */
function sanMoves(movetext: string): string[] {
	const moves: string[] = [];
	for (const token of movetext.trim().split(/\s+/)) {
		const move = cleanSan(token);
		if (move.length > 0) {
			moves.push(move);
		}
	}
	return moves;
}

/**
 * Replays a game into UCI, giving up gracefully.
 *
 * A game whose movetext will not fully replay is retried on shorter and shorter prefixes rather than
 * discarded: an archive game that goes wrong at move 38 still says everything worth knowing about
 * the opening, and dropping it would quietly change the counts. Only a game that will not replay at
 * all is skipped.
 */
function replay(san: readonly string[]): string[] | null {
	for (const limit of limits(san.length)) {
		const board = new Chess();
		const moves: string[] = [];

		for (let i = 0; i < limit; i++) {
			try {
				const move = board.move(san[i]);
				moves.push(`${move.from}${move.to}${move.promotion ?? ''}`);
			} catch {
				moves.length = 0;
				break;
			}
		}

		if (moves.length > 0) {
			return moves;
		}
	}
	return null;
}

function limits(plies: number): number[] {
	const capped = Math.min(plies, MAX_PLY);
	return [capped, ...RETRY_PREFIXES.filter((prefix) => prefix < capped)];
}
