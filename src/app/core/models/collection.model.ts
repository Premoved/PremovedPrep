/**
 * Collections and their contents.
 *
 * TWO LAYERS, AND WHY
 *
 * The types whose names begin with `Wire` are what the backend sends: a folder's name and an entry's
 * document arrive sealed, and nothing there can be shown to anyone. Everything else is what the
 * application works with, after CollectionApiService has opened them.
 *
 * CollectionSummary, ItemSummary and ItemDetail are unchanged from before end-to-end encryption, on
 * purpose. They are what the three components that draw collections bind to, and keeping them
 * identical is what let the encryption go in underneath those components rather than through them.
 */

export type CollectionKind = 'LIBRARY' | 'REPERTOIRE';

export type RepertoireColor = 'w' | 'b';

export type ItemType = 'ANALYSIS' | 'STUDY' | 'GAME' | 'MAIN_LINE' | 'MODEL_GAME';

export type ItemShape = 'DOCUMENT' | 'GAME';

export type CollectionIcon = 'folder' | 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king' | 'book' | 'star';

export const COLLECTION_ICONS: readonly CollectionIcon[] = [
	'folder',
	'book',
	'pawn',
	'knight',
	'bishop',
	'rook',
	'queen',
	'king',
];

export interface CollectionSummary {
	readonly id: number;
	readonly kind: CollectionKind;
	readonly color: RepertoireColor | null;
	readonly name: string;
	readonly icon: string;
	readonly sortOrder: number;
	readonly itemCount: number;
	readonly updatedAt: string;
}

/** A folder as it arrives: the shape of the shelf in the clear, the name sealed. */
export interface WireCollectionSummary extends Omit<CollectionSummary, 'name'> {
	readonly nameCipher: string;
}

/**
 * An entry as it arrives.
 *
 * There is one wire shape rather than the summary-and-detail pair the API used to have. The list
 * used to send the derived columns and hold the document back, because the document was the
 * expensive part; the columns are now inside the document, so a list that shows anything at all is
 * a list that sent everything - and the browser has to open it all anyway in order to sort it.
 */
export interface ItemRow {
	readonly id: number;
	readonly collectionId: number;
	readonly itemType: ItemType;
	readonly shape: ItemShape;
	readonly sortOrder: number;
	/** The sealed entry: the PGN, its title and its annotator. See item-payload.ts. */
	readonly payload: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface ItemSummary {
	readonly id: number;
	readonly itemType: ItemType;
	readonly shape: ItemShape;
	readonly sortOrder: number;

	readonly title: string | null;
	readonly author: string | null;

	readonly white: string | null;
	readonly whiteElo: number | null;
	readonly black: string | null;
	readonly blackElo: number | null;
	/** PGN token, or null for a row that was never played. Not the same as '*'. */
	readonly result: string | null;
	readonly event: string | null;
	/** ISO date, or null when the source tag was partial. `year` is set either way. */
	readonly date: string | null;
	readonly year: number | null;

	readonly eco: string | null;
	readonly plyCount: number;
	readonly startFen: string | null;
	readonly updatedAt: string;
}

/**
 * An entry with its moves. It now extends ItemSummary rather than omitting sortOrder from it: one
 * decrypt produces both, so the detail is what a listing actually holds and the summary is the view
 * of it that the table binds to.
 */
export interface ItemDetail extends ItemSummary {
	readonly collectionId: number;
	readonly pgn: string;
	readonly createdAt: string;
}

export type ItemSortKey =
	| 'MANUAL'
	| 'TYPE'
	| 'TYPE_STUDY_FIRST'
	| 'TYPE_GAME_FIRST'
	| 'WHITE'
	| 'BLACK'
	| 'WHITE_ELO'
	| 'BLACK_ELO'
	| 'RESULT'
	| 'ANNOTATOR'
	| 'ECO'
	| 'MOVES'
	| 'EVENT'
	| 'DATE'
	| 'UPDATED';

export interface ImportResult {
	readonly collectionId: number;
	readonly imported: number;
	readonly skipped: number;
	/** Games left out because the account ran out of room part-way through the file. */
	readonly skippedForSpace: number;
	readonly items: readonly ItemSummary[];
}

export const ITEM_TYPE_LABEL: Readonly<Record<ItemType, string>> = {
	ANALYSIS: 'analysis',
	STUDY: 'study',
	GAME: 'game',
	MAIN_LINE: 'main-line',
	MODEL_GAME: 'model-game',
};

export const ITEM_TYPES_BY_KIND: Readonly<Record<CollectionKind, readonly ItemType[]>> = {
	LIBRARY: ['ANALYSIS', 'STUDY', 'GAME'],
	REPERTOIRE: ['MAIN_LINE', 'MODEL_GAME'],
};

export const TYPE_SORT_STATES: Readonly<Partial<Record<ItemSortKey, readonly ItemType[]>>> = {
	TYPE: ['ANALYSIS', 'STUDY', 'GAME', 'MAIN_LINE', 'MODEL_GAME'],
	TYPE_STUDY_FIRST: ['STUDY', 'ANALYSIS', 'GAME', 'MAIN_LINE', 'MODEL_GAME'],
	TYPE_GAME_FIRST: ['GAME', 'ANALYSIS', 'STUDY', 'MAIN_LINE', 'MODEL_GAME'],
};

export const TYPE_SORT_KEYS: readonly ItemSortKey[] = ['TYPE', 'TYPE_STUDY_FIRST', 'TYPE_GAME_FIRST'];

export interface StorageUsage {
	readonly bytesUsed: number;
	/** The allowance shown to the user. */
	readonly bytesQuota: number;
	/** Where writes actually stop, a little above the quota. */
	readonly bytesHardLimit: number;
	/**
	 * The largest PGN one request that saves to the server may carry - a multiple of bytesQuota,
	 * decided by StorageLimits on the server. Absent on the figures recovered from a 507, which does
	 * not carry it, so a caller must treat null as "the server will decide".
	 *
	 * Since end-to-end encryption this counts the sealed entry, not the PGN. A document usually
	 * deflates to well under what it was before base64 adds a third back, so an account's allowance
	 * goes further than it did - but the figure a person sees is the one they actually occupy.
	 */
	readonly bytesMaxRequest?: number;
}
