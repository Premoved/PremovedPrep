import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GameDetail, GamePage, GameSortKey } from '../models/game-list.model';
import { OpeningTree } from '../models/opening-tree.model';

const PAGE_SIZE = 100;

/** The archive's surface: the Opening Tree for a position, and the games that reached it. */
@Injectable({ providedIn: 'root' })
export class OpeningExplorerService {
	private readonly http = inject(HttpClient);

	openingTree(fen: string): Observable<OpeningTree> {
		/**
		 * HttpParams rather than string concatenation, because a FEN contains characters that must be encoded.
		 */
		return this.http.get<OpeningTree>(`${environment.apiBaseUrl}/opening-tree`, {
			params: new HttpParams().set('fen', fen),
		});
	}

	gamesAtPosition(fen: string, sort: GameSortKey, ascending: boolean, page: number): Observable<GamePage> {
		return this.http.get<GamePage>(`${environment.apiBaseUrl}/games/at-position`, {
			params: new HttpParams()
				.set('fen', fen)
				.set('sort', sort)
				.set('ascending', ascending)
				.set('page', page)
				.set('size', PAGE_SIZE),
		});
	}

	game(id: number): Observable<GameDetail> {
		return this.http.get<GameDetail>(`${environment.apiBaseUrl}/games/${id}`);
	}
}
