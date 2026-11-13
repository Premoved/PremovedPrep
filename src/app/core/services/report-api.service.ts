import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdvancedReport, OpponentGames } from '../models/report.model';
import { OpponentScope } from '../models/search.model';
import { ItemDetail, RepertoireColor } from '../models/collection.model';
import { CollectionApiService } from './collection-api.service';
import { BookCollection } from '../report/repertoire-book';
import { buildReportOffThread } from '../report/report-thread';

// The overlay against the user's repertoire runs here, the only place it is readable; up to four
// thousand games' movetext comes down the wire instead of a finished tree.
@Injectable({ providedIn: 'root' })
export class ReportApiService {
	private readonly http = inject(HttpClient);
	private readonly collections = inject(CollectionApiService);
	private readonly baseUrl = `${environment.apiBaseUrl}/report`;

	advanced(scope: OpponentScope): Observable<AdvancedReport> {
		// Our colour is the opposite of the opponent's.
		const ourColor: RepertoireColor = scope.color === 'b' ? 'w' : 'b';

		return forkJoin({
			opponent: this.opponentGames(scope),
			repertoire: this.trunks(ourColor),
		}).pipe(
			switchMap(({ opponent, repertoire }) =>
				buildReportOffThread({
					trunks: repertoire.trunks,
					collections: repertoire.collections,
					games: opponent.games,
					fideId: opponent.fideId,
					opponentColor: opponent.opponentColor,
					truncated: opponent.truncated,
				}),
			),
		);
	}

	private opponentGames(scope: OpponentScope): Observable<OpponentGames> {
		let params = new HttpParams().set('fideId', scope.fideId).set('color', scope.color);
		if (scope.from) {
			params = params.set('from', scope.from);
		}
		if (scope.to) {
			params = params.set('to', scope.to);
		}
		return this.http.get<OpponentGames>(`${this.baseUrl}/opponent-games`, { params });
	}

	// One request per repertoire collection, usually already warm from the collections screen. The
	// collections' names and icons come along, for the cards that link back to these main lines.
	private trunks(
		color: RepertoireColor,
	): Observable<{ trunks: ItemDetail[]; collections: Map<number, BookCollection> }> {
		return this.collections.list('REPERTOIRE', color).pipe(
			switchMap((collections) =>
				(collections.length === 0
					? of([] as ItemDetail[][])
					: forkJoin(collections.map((collection) => this.collections.listDetails(collection.id)))
				).pipe(
					map((contents) => ({
						trunks: contents.flat().filter((item) => item.itemType === 'MAIN_LINE'),
						collections: new Map(
							collections.map((collection) => [collection.id, { name: collection.name, icon: collection.icon }]),
						),
					})),
				),
			),
		);
	}
}
