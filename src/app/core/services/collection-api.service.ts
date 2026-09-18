import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, from, map, of, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
	CollectionKind,
	CollectionSummary,
	ImportResult,
	ItemDetail,
	ItemRow,
	ItemSortKey,
	ItemSummary,
	ItemType,
	RepertoireColor,
	StorageUsage,
	WireCollectionSummary,
} from '../models/collection.model';
import { RepertoireTree } from '../models/repertoire.model';
import { VaultLockedError, VaultService } from '../crypto/vault.service';
import { convertTypeTo, deriveFields, importTypeFor, parsePgn, shapeOf, splitPgn } from '../chess/pgn-metadata';
import { compareItems } from './item-sort';
import { EMPTY_MAIN_LINE_PGN, ItemPayload, readPayload, writePayload } from './item-payload';
import { buildZip } from '../browser/zip';

/**
 * /api/collections - both the Library and the Repertoire.
 *
 * THIS CLASS IS THE ENCRYPTION BOUNDARY
 *
 * Its method signatures are the ones it always had: callers pass a PGN and a name and get back an
 * ItemSummary and a CollectionSummary. What changed is underneath. Nothing leaves here in the clear
 * and nothing arrives here readable; every PGN is sealed on the way out and every row is opened on
 * the way in, and the three components that use this service did not have to learn that.
 *
 * Keeping the surface identical was the point. An encryption layer that every caller has to
 * remember to use is one that some caller eventually forgets, and the forgetting is silent - the
 * feature works, and the data is in the clear. Here there is no way to reach /api/collections
 * except through a method that seals.
 *
 * WHAT MOVED IN HERE FROM THE SERVER
 *
 *   sorting     the server ordered by SQL columns derived from the PGN; those columns are gone, so
 *               a collection is fetched whole, decrypted, and sorted by compareItems
 *   importing   the server split a multi-game file; splitPgn does it here and posts the pieces
 *   exporting   the server concatenated and zipped; buildZip does it here and never sends anything
 *   linking     the repertoire tree was replayed on the server; repertoire-linker does it here
 *
 * Each of those is more code in the browser than it was on the server. That is the bill for the
 * guarantee, and it is paid once.
 */
@Injectable({ providedIn: 'root' })
export class CollectionApiService {
	private readonly http = inject(HttpClient);
	private readonly vault = inject(VaultService);
	private readonly baseUrl = `${environment.apiBaseUrl}/collections`;

	// -----------------------------------------------------------------
	// Collections
	// -----------------------------------------------------------------

	list(kind: CollectionKind, color?: RepertoireColor | null): Observable<CollectionSummary[]> {
		let params = new HttpParams().set('kind', kind);
		if (color) {
			params = params.set('color', color);
		}
		return this.http
			.get<WireCollectionSummary[]>(this.baseUrl, { params })
			.pipe(switchMap((rows) => from(this.openCollections(rows))));
	}

	get(id: number): Observable<CollectionSummary> {
		return this.http
			.get<WireCollectionSummary>(`${this.baseUrl}/${id}`)
			.pipe(switchMap((row) => from(this.openCollection(row))));
	}

	create(
		kind: CollectionKind,
		name: string,
		icon: string,
		color?: RepertoireColor | null,
	): Observable<CollectionSummary> {
		return from(this.vault.seal('collection-name', name)).pipe(
			switchMap((nameCipher) =>
				this.http.post<WireCollectionSummary>(this.baseUrl, {
					kind,
					nameCipher,
					icon,
					color: color ?? null,
				}),
			),
			switchMap((row) => from(this.openCollection(row))),
		);
	}

	update(id: number, changes: { name?: string; icon?: string; sortOrder?: number }): Observable<CollectionSummary> {
		const sealing =
			changes.name === undefined ? Promise.resolve(undefined) : this.vault.seal('collection-name', changes.name);

		return from(sealing).pipe(
			switchMap((nameCipher) =>
				this.http.patch<WireCollectionSummary>(`${this.baseUrl}/${id}`, {
					nameCipher,
					icon: changes.icon,
					sortOrder: changes.sortOrder,
				}),
			),
			switchMap((row) => from(this.openCollection(row))),
		);
	}

	remove(id: number): Observable<void> {
		return this.http.delete<void>(`${this.baseUrl}/${id}`);
	}

	/**
	 * Moves or copies whole folders onto the other shelf.
	 *
	 * Three things the server used to work out for itself have to be worked out here, because all
	 * three are reading: what each entry becomes on the new shelf (it depends on the starting
	 * position), what a copy should be called when the name is taken, and what the empty trunk a
	 * repertoire cannot be without looks like.
	 */
	transferCollections(
		kind: CollectionKind,
		color: RepertoireColor | null,
		collectionIds: readonly number[],
		copy: boolean,
	): Observable<CollectionSummary[]> {
		return forkJoin({
			existing: this.list(kind, color),
			sources: forkJoin(collectionIds.map((id) => this.get(id))),
			contents: forkJoin(collectionIds.map((id) => this.listDetails(id))),
		}).pipe(
			switchMap(({ existing, sources, contents }) =>
				from(this.planCollectionTransfer(kind, sources, contents, existing, copy)),
			),
			switchMap((collections) =>
				this.http.post<WireCollectionSummary[]>(`${this.baseUrl}/transfer`, {
					kind,
					color: color ?? null,
					collections,
					copy,
				}),
			),
			switchMap((rows) => from(this.openCollections(rows))),
		);
	}

	// -----------------------------------------------------------------
	// Entries
	// -----------------------------------------------------------------

	/**
	 * One collection's entries, decrypted and sorted here.
	 *
	 * `sort` and `ascending` keep the signature they had; what they no longer do is travel. The
	 * server hands back the collection in manual order and this sorts it, which is both the only
	 * thing that can work now and - for a folder of a few hundred entries that had to be fetched
	 * whole anyway - indistinguishable in speed from what it replaced.
	 */
	listItems(collectionId: number, sort: ItemSortKey, ascending?: boolean): Observable<ItemSummary[]> {
		return this.listDetails(collectionId).pipe(map((items) => sortItems(items, sort, ascending)));
	}

	/**
	 * The same fetch, with the PGN still attached.
	 *
	 * Everything that used to be a separate server endpoint - export, the repertoire tree, the
	 * Advanced Report's book, deciding what an entry becomes on the other shelf - needs the moves and
	 * not just the columns, and they are in hand already: opening a row produces the whole document,
	 * and listItems throws the text away only because ItemSummary is what the table binds to.
	 *
	 * Public for the report, which builds its book out of the trunks and is the one caller outside
	 * this class with a reason to see them.
	 */
	listDetails(collectionId: number): Observable<ItemDetail[]> {
		return this.http
			.get<ItemRow[]>(`${this.baseUrl}/${collectionId}/items`)
			.pipe(switchMap((rows) => from(this.openItems(rows))));
	}

	getItem(itemId: number): Observable<ItemDetail> {
		return this.http.get<ItemRow>(`${this.baseUrl}/items/${itemId}`).pipe(switchMap((row) => from(this.openItem(row))));
	}

	/** The PGN is sealed here; the server stores an envelope and derives nothing from it. */
	createItem(
		collectionId: number,
		itemType: ItemType,
		pgn: string,
		title?: string,
		author?: string,
	): Observable<ItemSummary> {
		return from(this.sealItem({ pgn, title: title ?? null, author: author ?? null })).pipe(
			switchMap((payload) => this.http.post<ItemRow>(`${this.baseUrl}/${collectionId}/items`, { itemType, payload })),
			switchMap((row) => from(this.openItem(row))),
		);
	}

	/** Omitting itemType leaves the existing type unchanged. */
	updateItem(
		itemId: number,
		pgn: string,
		title?: string,
		author?: string,
		itemType?: ItemType,
	): Observable<ItemSummary> {
		return from(this.sealItem({ pgn, title: title ?? null, author: author ?? null })).pipe(
			switchMap((payload) => this.http.put<ItemRow>(`${this.baseUrl}/items/${itemId}`, { payload, itemType })),
			switchMap((row) => from(this.openItem(row))),
		);
	}

	retagItem(itemId: number, itemType: ItemType): Observable<ItemSummary> {
		return this.http
			.patch<ItemRow>(`${this.baseUrl}/items/${itemId}/type`, { itemType })
			.pipe(switchMap((row) => from(this.openItem(row))));
	}

	removeItem(itemId: number): Observable<void> {
		return this.http.delete<void>(`${this.baseUrl}/items/${itemId}`);
	}

	reorderItems(collectionId: number, itemIds: readonly number[]): Observable<ItemSummary[]> {
		return this.http
			.patch<ItemRow[]>(`${this.baseUrl}/${collectionId}/items/order`, { itemIds })
			.pipe(switchMap((rows) => from(this.openItems(rows))));
	}

	/**
	 * A file, split here and posted as entries.
	 *
	 * The split is the same one the server did, in the same order, so a file that imported as
	 * fourteen games before imports as fourteen games now. Games with neither moves nor tags are
	 * dropped exactly as they were - an exporter's trailing newline is not an entry.
	 */
	importPgn(collectionId: number, pgn: string, itemType?: ItemType): Observable<ImportResult> {
		return this.get(collectionId).pipe(
			switchMap((collection) => {
				const games = splitPgn(pgn).filter((game) => game.plyCount > 0 || Object.keys(game.tags).length > 0);
				const skipped = splitPgn(pgn).length - games.length;

				if (games.length === 0) {
					throw new Error('That file contains no games');
				}

				return from(
					Promise.all(
						games.map(async (game) => ({
							itemType: itemType ?? importTypeFor(collection.kind, game),
							payload: await this.sealItem({ pgn: game.pgn, title: null, author: null }),
						})),
					),
				).pipe(
					switchMap((items) =>
						this.http.post<{
							collectionId: number;
							imported: number;
							skippedForSpace: number;
							items: ItemRow[];
						}>(`${this.baseUrl}/${collectionId}/items/batch`, { items }),
					),
					switchMap((result) =>
						from(this.openItems(result.items)).pipe(
							map((opened) => ({
								collectionId: result.collectionId,
								imported: result.imported,
								skipped,
								skippedForSpace: result.skippedForSpace,
								items: opened,
							})),
						),
					),
				);
			}),
		);
	}

	/**
	 * Moves or copies entries into another folder. The target type for each one is decided here, for
	 * the same reason it is in transferCollections: it depends on the starting position.
	 */
	transferItems(targetCollectionId: number, itemIds: readonly number[], copy: boolean): Observable<ItemSummary[]> {
		return forkJoin({
			target: this.get(targetCollectionId),
			items: forkJoin(itemIds.map((id) => this.getItem(id))),
		}).pipe(
			switchMap(({ target, items }) =>
				this.http.post<ItemRow[]>(`${this.baseUrl}/${targetCollectionId}/items/transfer`, {
					items: items.map((item) => ({
						itemId: item.id,
						itemType: convertTypeTo(target.kind, item.itemType, item.startFen),
					})),
					copy,
				}),
			),
			switchMap((rows) => from(this.openItems(rows))),
		);
	}

	// -----------------------------------------------------------------
	// Export, which no longer leaves the browser
	// -----------------------------------------------------------------

	exportCollection(id: number): Observable<Blob> {
		return this.listDetails(id).pipe(map((items) => new Blob([joinPgn(items)], { type: 'application/x-chess-pgn' })));
	}

	exportArchive(kind: CollectionKind, color: RepertoireColor | null, ids: readonly number[] = []): Observable<Blob> {
		return this.list(kind, color).pipe(
			map((all) => (ids.length === 0 ? all : all.filter((collection) => ids.includes(collection.id)))),
			switchMap((chosen) =>
				chosen.length === 0
					? of(buildZip([]))
					: forkJoin(chosen.map((collection) => this.listDetails(collection.id))).pipe(
							map((contents) => buildZip(zipEntriesFor(chosen, contents))),
						),
			),
		);
	}

	/** The name the export downloads as. The rule the server's fileName() used, unchanged. */
	fileNameFor(name: string): string {
		const cleaned = name
			.trim()
			.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
			.trim()
			.slice(0, 80)
			.trim();
		return cleaned.length === 0 ? 'collection' : cleaned;
	}

	// -----------------------------------------------------------------

	/**
	 * Where a repertoire's model games join its theory.
	 *
	 * Built here, from entries this browser has decrypted, by the port of what RepertoireLinkService
	 * used to do. It is a local computation with an Observable around it so that the call site reads
	 * the way it always did.
	 */
	repertoireTree(itemId: number): Observable<RepertoireTree> {
		return this.getItem(itemId).pipe(
			switchMap((trunk) =>
				forkJoin({
					trunk: of(trunk),
					collection: this.get(trunk.collectionId),
					items: this.listDetails(trunk.collectionId),
				}),
			),
			switchMap(({ trunk, collection, items }) =>
				from(import('../repertoire/repertoire-linker')).pipe(
					map(({ buildRepertoireTree }) => buildRepertoireTree(trunk, collection, items)),
				),
			),
		);
	}

	storage(): Observable<StorageUsage> {
		return this.http.get<StorageUsage>(`${this.baseUrl}/storage`);
	}

	// -----------------------------------------------------------------
	// Sealing and opening
	// -----------------------------------------------------------------

	private sealItem(payload: ItemPayload): Promise<string> {
		return this.vault.seal('item', writePayload(payload));
	}

	private async openItem(row: ItemRow): Promise<ItemDetail> {
		const payload = readPayload(await this.vault.open('item', row.payload));
		const fields = deriveFields(row.itemType, parsePgn(payload.pgn), payload.title, payload.author);

		return {
			id: row.id,
			collectionId: row.collectionId,
			itemType: row.itemType,
			shape: shapeOf(row.itemType),
			sortOrder: row.sortOrder,
			pgn: payload.pgn,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			...fields,
		};
	}

	/**
	 * A collection, opened all at once.
	 *
	 * Sequential rather than Promise.all over hundreds of entries: each one is a decrypt and a
	 * decompress, and firing a folder's worth at the event loop together makes the tab unresponsive
	 * for as long as it takes rather than for each step.
	 *
	 * A single entry that will not open is dropped and logged - one damaged row must not make a whole
	 * folder unreadable. A LOCKED vault is the opposite case and is rethrown: every row would fail,
	 * and swallowing them would hand the screen an empty list. "You have no games" and "this browser
	 * does not have your key yet" are different sentences, and showing the first when the second is
	 * true reads to a person as their work having been deleted.
	 */
	private async openItems(rows: readonly ItemRow[]): Promise<ItemDetail[]> {
		const opened: ItemDetail[] = [];
		for (const row of rows) {
			try {
				opened.push(await this.openItem(row));
			} catch (error) {
				if (error instanceof VaultLockedError) {
					throw error;
				}
				console.warn(`Entry ${row.id} could not be decrypted and was left out of the list`, error);
			}
		}
		return opened;
	}

	private async openCollection(row: WireCollectionSummary): Promise<CollectionSummary> {
		return { ...row, name: await this.vault.open('collection-name', row.nameCipher) };
	}

	/** Same rule as openItems: a bad row is dropped, a locked vault is a state and not a row. */
	private async openCollections(rows: readonly WireCollectionSummary[]): Promise<CollectionSummary[]> {
		const opened: CollectionSummary[] = [];
		for (const row of rows) {
			try {
				opened.push(await this.openCollection(row));
			} catch (error) {
				if (error instanceof VaultLockedError) {
					throw error;
				}
				console.warn(`Collection ${row.id} could not be decrypted and was left out of the list`, error);
			}
		}
		return opened;
	}

	/** The per-folder decisions a cross-shelf transfer needs, made where the names are readable. */
	private async planCollectionTransfer(
		kind: CollectionKind,
		sources: readonly CollectionSummary[],
		contents: readonly ItemDetail[][],
		existing: readonly CollectionSummary[],
		copy: boolean,
	) {
		const taken = new Set(existing.map((collection) => collection.name.toLowerCase()));
		const planned = [];

		for (let i = 0; i < sources.length; i++) {
			const source = sources[i];
			const items = contents[i] ?? [];

			const name = copy || taken.has(source.name.toLowerCase()) ? freeName(taken, source.name) : null;
			if (name !== null) {
				taken.add(name.toLowerCase());
			}

			const retyped = items.map((item) => ({
				itemId: item.id,
				itemType: convertTypeTo(kind, item.itemType, item.startFen),
			}));

			const needsTrunk = kind === 'REPERTOIRE' && !retyped.some((item) => item.itemType === 'MAIN_LINE');

			planned.push({
				collectionId: source.id,
				nameCipher: name === null ? null : await this.vault.seal('collection-name', name),
				items: retyped,
				trunkPayload: needsTrunk ? await this.sealItem({ pgn: EMPTY_MAIN_LINE_PGN, title: null, author: null }) : null,
			});
		}
		return planned;
	}
}

/** The sorting the server used to do in SQL, done here over what has just been decrypted. */
function sortItems(items: readonly ItemDetail[], sort: ItemSortKey, ascending?: boolean): ItemSummary[] {
	return compareItems(items, sort, ascending);
}

function joinPgn(items: readonly ItemDetail[]): string {
	const bodies = items.map((item) => item.pgn.trim()).filter((pgn) => pgn.length > 0);
	return `${bodies.join('\n\n')}\n`;
}

function zipEntriesFor(collections: readonly CollectionSummary[], contents: readonly ItemDetail[][]) {
	const used = new Set<string>();
	return collections.map((collection, index) => {
		const base =
			collection.name
				.trim()
				.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
				.slice(0, 80) || 'collection';
		let name = `${base}.pgn`;
		for (let suffix = 2; used.has(name); suffix++) {
			name = `${base} (${suffix}).pgn`;
		}
		used.add(name);
		return { name, text: joinPgn(contents[index] ?? []) };
	});
}

/** 'Sicilian', then 'Sicilian (2)', until the name is free. The server's freeName(), moved. */
function freeName(taken: ReadonlySet<string>, name: string): string {
	if (!taken.has(name.toLowerCase())) {
		return name;
	}
	for (let suffix = 2; suffix < 1000; suffix++) {
		const candidate = `${name} (${suffix})`;
		if (!taken.has(candidate.toLowerCase())) {
			return candidate;
		}
	}
	throw new Error(`Too many collections called "${name}"`);
}
