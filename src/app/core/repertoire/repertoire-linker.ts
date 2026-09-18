import { CollectionSummary, ItemDetail } from '../models/collection.model';
import { PgnTreeNode, childByUci, mainlineOf, parsePgnTree, pathOf } from '../chess/pgn-tree';
import { RepertoireAttachment, RepertoireBranch, RepertoireGame, RepertoireTree } from '../models/repertoire.model';

/**
 * Where a repertoire's model games join its theory.
 *
 * This is the port of RepertoireLinkService, which did the same thing on the server by replaying
 * every model game against every trunk. It had to move: the placement is computed from the moves,
 * and the moves are sealed now. It is also cheaper here - the entries have just been decrypted for
 * the list, so the replay happens over PGNs already in hand, and there is no per-request backfill of
 * derived columns to keep in step.
 *
 * WHAT THE PLACEMENT RULE IS
 *
 * A model game is placed at the point where it leaves the theory: walk the trunk's positions, find
 * the deepest one the game also passes through and from which the game plays something the trunk
 * does not, and attach it there. A game that follows one trunk deeper than this one is not drawn
 * here at all - it belongs to the other trunk - and a tie is drawn on both, which is what the
 * original's `best`/`here` comparison says.
 *
 * WHAT IS NOT INDEXED, AND WHY
 *
 * Only the mainline of a model game. A model game is a game that was played, and the moves that were
 * played are its mainline; an annotator's side lines are commentary on it, not other games, and
 * treating them as branches would attach one game to the trunk in a dozen places. V11's schema note
 * made the same argument about the columns this replaces.
 *
 * POSITIONS ARE KEYED BY THEIR EPD
 *
 * The server keyed them by a 64-bit Zobrist hash, because they were a Postgres BIGINT[] that had to
 * be compared in SQL. Nothing is stored now, so the key can be the position itself: the first four
 * FEN fields, which is what an EPD is and what "the same position" means. It is longer than a hash
 * and it cannot collide, which for a comparison done inside one function is the better trade.
 *
 * The reading itself is pgn-tree.ts, shared with the Advanced Report's book. Two readers of the same
 * documents would eventually disagree about one of them, and nobody would be able to say which was
 * right.
 */

interface TrunkIndex {
	readonly root: PgnTreeNode;
	readonly byPosition: Map<string, PgnTreeNode[]>;
	/** Depth-first, first child first - the order the client draws them in. */
	readonly order: Map<PgnTreeNode, number>;
}

/** How far a game got on one trunk, and where it stopped. */
interface Fit {
	readonly node: PgnTreeNode;
	readonly ply: number;
	readonly order: number;
}

/** A model game reduced to what the placement needs. */
interface Walk {
	readonly item: ItemDetail;
	readonly positions: readonly string[];
	readonly moves: readonly string[];
}

export function buildRepertoireTree(
	trunk: ItemDetail,
	collection: CollectionSummary,
	items: readonly ItemDetail[],
): RepertoireTree {
	const trunks = items.filter((item) => item.itemType === 'MAIN_LINE');
	const models = items.filter((item) => item.itemType === 'MODEL_GAME');

	const indexes = new Map<number, TrunkIndex>();
	for (const candidate of trunks) {
		indexes.set(candidate.id, indexTrunk(parsePgnTree(candidate.pgn, candidate.startFen)));
	}
	if (!indexes.has(trunk.id)) {
		indexes.set(trunk.id, indexTrunk(parsePgnTree(trunk.pgn, trunk.startFen)));
	}

	const placements: { walk: Walk; node: PgnTreeNode; ply: number }[] = [];
	for (const model of models) {
		const walk = walkOf(model);
		const placement = placeOn(walk, trunk.id, indexes);
		if (placement !== null) {
			placements.push({ walk, node: placement.node, ply: placement.ply });
		}
	}

	return {
		itemId: trunk.id,
		collectionId: trunk.collectionId,
		color: collection.color,
		modelGames: models.length,
		linked: placements.length,
		attachments: attachmentsFor(placements),
	};
}

/**
 * The deepest fit on this trunk, provided no other trunk fits deeper.
 *
 * A game that leaves trunk A at move 12 and trunk B at move 6 is theory for A and a curiosity for B,
 * and drawing it on both would fill every trunk in the folder with every game in it.
 */
function placeOn(walk: Walk, trunkId: number, indexes: ReadonlyMap<number, TrunkIndex>): Fit | null {
	let best: Fit | null = null;
	let here: Fit | null = null;

	for (const [id, index] of indexes) {
		const fit = fitOn(walk, index);
		if (fit === null) {
			continue;
		}
		if (best === null || fit.ply > best.ply) {
			best = fit;
		}
		if (id === trunkId) {
			here = fit;
		}
	}

	/** A tie is drawn on every trunk that ties. */
	if (best === null || here === null || here.ply < best.ply) {
		return null;
	}
	return here;
}

function fitOn(walk: Walk, trunk: TrunkIndex): Fit | null {
	let best: Fit | null = null;

	for (let ply = 0; ply < walk.positions.length; ply++) {
		const nodes = trunk.byPosition.get(walk.positions[ply]);
		if (nodes === undefined) {
			continue;
		}
		for (const node of nodes) {
			/** Past the last move there is nothing left to follow. */
			const leaves = ply === walk.moves.length || childByUci(node, walk.moves[ply]) === undefined;
			if (!leaves) {
				continue;
			}

			const order = trunk.order.get(node) ?? Number.MAX_SAFE_INTEGER;
			if (best === null || ply > best.ply || (ply === best.ply && order < best.order)) {
				best = { node, ply, order };
			}
		}
	}
	return best;
}

function attachmentsFor(placements: readonly { walk: Walk; node: PgnTreeNode; ply: number }[]): RepertoireAttachment[] {
	const byNode = new Map<PgnTreeNode, { walk: Walk; ply: number }[]>();
	for (const placement of placements) {
		const group = byNode.get(placement.node) ?? [];
		group.push({ walk: placement.walk, ply: placement.ply });
		byNode.set(placement.node, group);
	}

	const attachments: RepertoireAttachment[] = [];
	for (const [node, group] of byNode) {
		const { branches, ending } = expand(group);
		if (branches.length === 0 && ending.length === 0) {
			continue;
		}
		attachments.push({ path: pathOf(node), games: ending, branches });
	}

	/** Shallowest first, so a client drawing them in order never forward-references. */
	return attachments.sort((left, right) => left.path.length - right.path.length);
}

function expand(walkers: readonly { walk: Walk; ply: number }[]): {
	branches: RepertoireBranch[];
	ending: RepertoireGame[];
} {
	const ending: RepertoireGame[] = [];
	const byMove = new Map<string, { walk: Walk; ply: number }[]>();

	for (const walker of walkers) {
		if (walker.ply >= walker.walk.moves.length) {
			/** It ran out of moves standing here, so here is where its card goes. */
			ending.push(cardFor(walker.walk, walker.ply));
			continue;
		}
		const move = walker.walk.moves[walker.ply];
		const group = byMove.get(move) ?? [];
		group.push(walker);
		byMove.set(move, group);
	}

	const branches: RepertoireBranch[] = [];
	for (const [uci, group] of byMove) {
		if (group.length === 1) {
			const only = group[0];
			/** The branch node is the position after this move. */
			branches.push({ uci, games: [cardFor(only.walk, only.ply + 1)], children: [] });
			continue;
		}

		const below = expand(group.map((walker) => ({ walk: walker.walk, ply: walker.ply + 1 })));
		branches.push({ uci, games: below.ending, children: below.branches });
	}

	return { branches, ending };
}

function cardFor(walk: Walk, ply: number): RepertoireGame {
	const item = walk.item;
	return {
		itemId: item.id,
		white: item.white,
		whiteElo: item.whiteElo,
		black: item.black,
		blackElo: item.blackElo,
		result: item.result,
		event: item.event,
		date: item.date,
		year: item.year,
		eco: item.eco,
		plyCount: item.plyCount,
		ply: Math.max(0, Math.min(ply, item.plyCount)),
	};
}

// ---------------------------------------------------------------------
// Replaying the documents
// ---------------------------------------------------------------------

/**
 * A model game's mainline: the position before each half-move, and the half-moves in UCI.
 *
 * Only the mainline, which is what parsePgnTree's first-child walk gives: a model game is a game
 * that was played, and the moves that were played are its mainline.
 */
function walkOf(item: ItemDetail): Walk {
	const root = parsePgnTree(item.pgn, item.startFen);
	const line = mainlineOf(root);

	return {
		item,
		positions: [root.epd, ...line.map((node) => node.epd)],
		moves: line.map((node) => node.uci as string),
	};
}

function indexTrunk(root: PgnTreeNode): TrunkIndex {
	const byPosition = new Map<string, PgnTreeNode[]>();
	const order = new Map<PgnTreeNode, number>();

	const visit = (node: PgnTreeNode): void => {
		const group = byPosition.get(node.epd) ?? [];
		group.push(node);
		byPosition.set(node.epd, group);
		order.set(node, order.size);

		for (const child of node.children) {
			visit(child);
		}
	};
	visit(root);

	return { root, byPosition, order };
}
