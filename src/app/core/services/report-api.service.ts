import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdvancedReport, OpponentGames } from '../models/report.model';
import { OpponentScope } from '../models/search.model';
import { ItemDetail, RepertoireColor } from '../models/collection.model';
import { CollectionApiService } from './collection-api.service';
import { buildBook } from '../report/repertoire-book';
import { buildAdvancedReport } from '../report/advanced-report';

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
			trunks: this.trunks(ourColor),
		}).pipe(
			map(({ opponent, trunks }) =>
				buildAdvancedReport(
					buildBook(trunks),
					opponent.games,
					opponent.fideId,
					opponent.opponentColor,
					opponent.truncated,
				),
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

	// One request per repertoire collection, usually already warm from the collections screen.
	private trunks(color: RepertoireColor): Observable<ItemDetail[]> {
		return this.collections.list('REPERTOIRE', color).pipe(
			switchMap((collections) =>
				collections.length === 0
					? of([] as ItemDetail[][])
					: forkJoin(collections.map((collection) => this.collections.listDetails(collection.id))),
			),
			map((contents) => contents.flat().filter((item) => item.itemType === 'MAIN_LINE')),
		);
	}
}
