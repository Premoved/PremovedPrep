import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
	CollectionKind,
	CollectionSummary,
	ImportResult,
	ItemDetail,
	ItemSortKey,
	ItemSummary,
	ItemType,
	RepertoireColor,
	StorageUsage,
} from '../models/collection.model';
import { RepertoireTree } from '../models/repertoire.model';

/** /api/collections - both the Library and the Repertoire. */
@Injectable({ providedIn: 'root' })
export class CollectionApiService {
	private readonly http = inject(HttpClient);
	private readonly baseUrl = `${environment.apiBaseUrl}/collections`;

	list(kind: CollectionKind, color?: RepertoireColor | null) {
		let params = new HttpParams().set('kind', kind);
		if (color) {
			params = params.set('color', color);
		}
		return this.http.get<CollectionSummary[]>(this.baseUrl, { params });
	}

	get(id: number) {
		return this.http.get<CollectionSummary>(`${this.baseUrl}/${id}`);
	}

	create(kind: CollectionKind, name: string, icon: string, color?: RepertoireColor | null) {
		return this.http.post<CollectionSummary>(this.baseUrl, { kind, name, icon, color: color ?? null });
	}

	update(id: number, changes: { name?: string; icon?: string; sortOrder?: number }) {
		return this.http.patch<CollectionSummary>(`${this.baseUrl}/${id}`, changes);
	}

	remove(id: number) {
		return this.http.delete<void>(`${this.baseUrl}/${id}`);
	}

	transferCollections(
		kind: CollectionKind,
		color: RepertoireColor | null,
		collectionIds: readonly number[],
		copy: boolean,
	) {
		return this.http.post<CollectionSummary[]>(`${this.baseUrl}/transfer`, {
			kind,
			color: color ?? null,
			collectionIds,
			copy,
		});
	}

	exportCollection(id: number) {
		return this.http.get(`${this.baseUrl}/${id}/export`, { responseType: 'blob' });
	}

	exportArchive(kind: CollectionKind, color: RepertoireColor | null, ids: readonly number[] = []) {
		let params = new HttpParams().set('kind', kind);
		if (color) {
			params = params.set('color', color);
		}
		for (const id of ids) {
			params = params.append('ids', id);
		}
		return this.http.get(`${this.baseUrl}/export`, { params, responseType: 'blob' });
	}

	listItems(collectionId: number, sort: ItemSortKey, ascending?: boolean) {
		let params = new HttpParams().set('sort', sort);
		if (ascending !== undefined) {
			params = params.set('ascending', ascending);
		}
		return this.http.get<ItemSummary[]>(`${this.baseUrl}/${collectionId}/items`, { params });
	}

	getItem(itemId: number) {
		return this.http.get<ItemDetail>(`${this.baseUrl}/items/${itemId}`);
	}

	/** The PGN is the whole request; the server derives players, result, ECO and date from it. */
	createItem(collectionId: number, itemType: ItemType, pgn: string, title?: string, author?: string) {
		return this.http.post<ItemSummary>(`${this.baseUrl}/${collectionId}/items`, { itemType, pgn, title, author });
	}

	/** Omitting itemType leaves the existing type unchanged. */
	updateItem(itemId: number, pgn: string, title?: string, author?: string, itemType?: ItemType) {
		return this.http.put<ItemSummary>(`${this.baseUrl}/items/${itemId}`, { pgn, title, author, itemType });
	}

	retagItem(itemId: number, itemType: ItemType) {
		return this.http.patch<ItemSummary>(`${this.baseUrl}/items/${itemId}/type`, { itemType });
	}

	removeItem(itemId: number) {
		return this.http.delete<void>(`${this.baseUrl}/items/${itemId}`);
	}

	reorderItems(collectionId: number, itemIds: readonly number[]) {
		return this.http.patch<ItemSummary[]>(`${this.baseUrl}/${collectionId}/items/order`, { itemIds });
	}

	importPgn(collectionId: number, pgn: string, itemType?: ItemType) {
		return this.http.post<ImportResult>(`${this.baseUrl}/${collectionId}/import`, { pgn, itemType });
	}

	transferItems(targetCollectionId: number, itemIds: readonly number[], copy: boolean) {
		return this.http.post<ItemSummary[]>(`${this.baseUrl}/${targetCollectionId}/items/transfer`, { itemIds, copy });
	}

	repertoireTree(itemId: number) {
		return this.http.get<RepertoireTree>(`${this.baseUrl}/items/${itemId}/repertoire-tree`);
	}

	ecoPreview(pgn: string) {
		return this.http.post<{ eco: string | null }>(`${this.baseUrl}/eco-preview`, { pgn });
	}

	storage() {
		return this.http.get<StorageUsage>(`${this.baseUrl}/storage`);
	}
}
