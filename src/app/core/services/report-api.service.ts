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

/**
 * The Advanced Report.
 *
 * `advanced(scope)` has the signature it always had and answers the same AdvancedReport, so the
 * screen that draws it is unchanged. What moved is where the work happens: the server sends the
 * opponent's games, and the overlay against the user's repertoire is computed here, because here is
 * the only place the repertoire is readable.
 *
 * The cost is honest and worth naming: up to four thousand games' movetext comes down the wire
 * instead of a finished tree. It is public archive text, it compresses well, and it is the price of
 * the server not holding the other half.
 */
@Injectable({ providedIn: 'root' })
export class ReportApiService {
	private readonly http = inject(HttpClient);
	private readonly collections = inject(CollectionApiService);
	private readonly baseUrl = `${environment.apiBaseUrl}/report`;

	advanced(scope: OpponentScope): Observable<AdvancedReport> {
		/** The colour we play is the opposite of the one the opponent had. */
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

	/**
	 * Every trunk of one colour, decrypted.
	 *
	 * One request per repertoire collection, which is how many a person has - a handful - and they
	 * are the same requests the collections screen makes, so they are usually warm in the browser's
	 * cache by the time a report is asked for.
	 */
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
