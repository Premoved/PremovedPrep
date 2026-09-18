import { ItemSortKey, ItemSummary, ItemType } from '../models/collection.model';

/**
 * The orderings a collection's list offers, done here.
 *
 * This is the port of the backend's ItemSort enum, which expressed each ordering as the SQL column
 * it sorted by. Those columns were projections of the PGN and are gone, so the comparison happens
 * where the values are readable - and the point of porting it rather than writing something new is
 * that a folder a person sorted by White last week has to come back in the same order this week.
 *
 * The three rules that made the SQL version behave the way it did, kept exactly:
 *
 *   NULLS LAST, in both directions. An entry with no rating does not become the top of the list by
 *   reversing the sort; absent is absent either way, and it belongs at the bottom.
 *
 *   ties break on id. `ORDER BY <column> <direction>, ci.id` - so two games between the same two
 *   players keep a stable order rather than shuffling between renders.
 *
 *   White and Black compare across the two row shapes. V2's generated columns were
 *   lower(coalesce(white_name, title)) and lower(coalesce(black_name, author)), because a text entry
 *   puts its title where a game puts its players. whiteKey and blackKey are those expressions.
 */

/** The order the TYPE sorts group by, as the SQL CASE did. */
const TYPE_RANK: Readonly<Record<ItemSortKey, Partial<Record<ItemType, number>>>> = {
	TYPE: { ANALYSIS: 1, STUDY: 2, GAME: 3, MAIN_LINE: 1, MODEL_GAME: 2 },
	TYPE_STUDY_FIRST: { STUDY: 1, ANALYSIS: 2, GAME: 3, MAIN_LINE: 1, MODEL_GAME: 2 },
	TYPE_GAME_FIRST: { GAME: 1, ANALYSIS: 2, STUDY: 3, MAIN_LINE: 1, MODEL_GAME: 2 },
	MANUAL: {},
	WHITE: {},
	BLACK: {},
	WHITE_ELO: {},
	BLACK_ELO: {},
	RESULT: {},
	ANNOTATOR: {},
	ECO: {},
	MOVES: {},
	EVENT: {},
	DATE: {},
	UPDATED: {},
};

/** Whether a key sorts ascending when the caller does not say. ItemSort.defaultsAscending(). */
export function defaultsAscending(sort: ItemSortKey): boolean {
	switch (sort) {
		case 'MANUAL':
		case 'TYPE':
		case 'TYPE_STUDY_FIRST':
		case 'TYPE_GAME_FIRST':
		case 'WHITE':
		case 'BLACK':
		case 'ANNOTATOR':
		case 'ECO':
		case 'EVENT':
			return true;
		default:
			return false;
	}
}

export function compareItems<T extends ItemSummary>(
	items: readonly T[],
	sort: ItemSortKey,
	ascending?: boolean,
): T[] {
	const direction = (ascending ?? defaultsAscending(sort)) ? 1 : -1;

	return [...items].sort((left, right) => {
		const a = keyOf(left, sort);
		const b = keyOf(right, sort);

		/** NULLS LAST, whichever way round the sort is. */
		if (a === null && b === null) {
			return left.id - right.id;
		}
		if (a === null) {
			return 1;
		}
		if (b === null) {
			return -1;
		}

		const ordered =
			typeof a === 'number' && typeof b === 'number'
				? a - b
				: String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

		return ordered !== 0 ? ordered * direction : left.id - right.id;
	});
}

function keyOf(item: ItemSummary, sort: ItemSortKey): string | number | null {
	switch (sort) {
		case 'MANUAL':
			return item.sortOrder;

		case 'TYPE':
		case 'TYPE_STUDY_FIRST':
		case 'TYPE_GAME_FIRST':
			return TYPE_RANK[sort][item.itemType] ?? null;

		case 'WHITE':
			return lower(item.white ?? item.title);
		case 'BLACK':
			return lower(item.black ?? item.author);

		case 'WHITE_ELO':
			return item.whiteElo;
		case 'BLACK_ELO':
			return item.blackElo;

		/** The stored code, not the token, and NULLIF(result, -2): White wins, draws, Black wins. */
		case 'RESULT':
			return resultRank(item.result);

		case 'ANNOTATOR':
			return lower(item.author);
		case 'ECO':
			return item.eco;

		/** NULLIF(ply_count, 0): an entry with no moves sorts as absent rather than as shortest. */
		case 'MOVES':
			return item.plyCount === 0 ? null : item.plyCount;

		case 'EVENT':
			return lower(item.event);
		case 'DATE':
			return item.date;
		case 'UPDATED':
			return item.updatedAt;
	}
}

/** GameResultCode's encoding: 1 White, 0 draw, -1 Black, -2 unknown - and unknown sorts as absent. */
function resultRank(token: string | null): number | null {
	switch (token) {
		case '1-0':
			return 1;
		case '1/2-1/2':
			return 0;
		case '0-1':
			return -1;
		default:
			return null;
	}
}

function lower(value: string | null): string | null {
	return value === null || value.trim().length === 0 ? null : value.toLowerCase();
}
