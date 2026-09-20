import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { OpeningTree } from '../models/opening-tree.model';
import {
	AdvancedCriteria,
	OpponentScope,
	PlayerProfile,
	PlayerSuggestion,
	SearchColor,
	SearchResultPage,
	SearchSortKey,
} from '../models/search.model';

const PAGE_SIZE = 100;

export const RECENT_PREVIEW_SIZE = 30;

/** /api/search and the FIDE autocomplete. */
@Injectable({ providedIn: 'root' })
export class SearchApiService {
	private readonly http = inject(HttpClient);
	private readonly baseUrl = `${environment.apiBaseUrl}/search`;

	/** Autocomplete for the opponent box: always the FIDE list. */
	suggestPlayers(query: string, limit = 12): Observable<PlayerSuggestion[]> {
		return this.http.get<PlayerSuggestion[]>(`${environment.apiBaseUrl}/players/search`, {
			params: new HttpParams().set('q', query).set('limit', limit),
		});
	}

	playerProfile(fideId: number): Observable<PlayerProfile> {
		return this.http.get<PlayerProfile>(`${this.baseUrl}/player/${fideId}`);
	}

	opponentGames(
		fideId: number,
		color: SearchColor,
		from: string | null,
		to: string | null,
		sort: SearchSortKey,
		ascending: boolean,
		page: number,
	): Observable<SearchResultPage> {
		let params = new HttpParams()
			.set('fideId', fideId)
			.set('color', color)
			.set('sort', sort)
			.set('ascending', ascending)
			.set('page', page)
			.set('size', PAGE_SIZE);
		params = withOptional(params, 'from', from);
		params = withOptional(params, 'to', to);

		return this.http.get<SearchResultPage>(`${this.baseUrl}/opponent`, { params });
	}

	opponentOpeningTree(scope: OpponentScope, fen: string): Observable<OpeningTree> {
		let params = new HttpParams().set('fideId', scope.fideId).set('color', scope.color).set('fen', fen);
		params = withOptional(params, 'from', scope.from);
		params = withOptional(params, 'to', scope.to);

		return this.http.get<OpeningTree>(`${this.baseUrl}/opponent/opening-tree`, { params });
	}

	recent(sort: SearchSortKey, ascending: boolean, size = RECENT_PREVIEW_SIZE): Observable<SearchResultPage> {
		const params = new HttpParams().set('sort', sort).set('ascending', ascending).set('size', size);
		return this.http.get<SearchResultPage>(`${this.baseUrl}/recent`, { params });
	}

	advanced(
		criteria: AdvancedCriteria,
		sort: SearchSortKey,
		ascending: boolean,
		page: number,
	): Observable<SearchResultPage> {
		let params = new HttpParams()
			.set('sort', sort)
			.set('ascending', ascending)
			.set('page', page)
			.set('size', PAGE_SIZE);

		params = withOptional(params, 'white', criteria.white);
		params = withOptional(params, 'black', criteria.black);
		if (criteria.ignoreColours) {
			params = params.set('ignoreColours', true);
		}
		params = withOptional(params, 'whiteEloMin', criteria.whiteEloMin);
		params = withOptional(params, 'whiteEloMax', criteria.whiteEloMax);
		params = withOptional(params, 'blackEloMin', criteria.blackEloMin);
		params = withOptional(params, 'blackEloMax', criteria.blackEloMax);
		params = withOptional(params, 'from', criteria.from);
		params = withOptional(params, 'to', criteria.to);
		params = withOptional(params, 'event', criteria.event);
		params = withOptional(params, 'eco', criteria.eco);
		/** Repeatable parameters rather than comma-joined, which is what Spring reads back into a list. */
		for (const token of criteria.results) {
			params = params.append('results', token);
		}

		return this.http.get<SearchResultPage>(`${this.baseUrl}/advanced`, { params });
	}
}

function withOptional(params: HttpParams, key: string, value: string | null | undefined): HttpParams {
	const trimmed = value?.trim();
	return trimmed ? params.set(key, trimmed) : params;
}
