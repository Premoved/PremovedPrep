import { Injectable } from '@angular/core';
import { AdvancedReport } from '../../../core/models/report.model';
import { OpponentScope } from '../../../core/models/search.model';

/**
 * The Advanced Report a search page last generated, kept for as long as the page is.
 *
 * The report panel is taken off the page when another panel is chosen, and it used to generate the
 * whole report again - the opponent's games fetched and every one of them replayed - each time it
 * came back. Nothing it is made from changes between one click on a tab and the next, so the page
 * keeps the finished report, and only a different player, colour or date range asks for a new one.
 *
 * Provided by the search page rather than the application, so each page - each tab, in the desktop
 * application - keeps its own, and it goes when the page does. It holds one report: the one that
 * belongs to the search the page is showing.
 */
@Injectable()
export class AdvancedReportCache {
	private kept: { readonly key: string; readonly report: AdvancedReport } | null = null;

	get(scope: OpponentScope): AdvancedReport | null {
		return this.kept?.key === scopeKey(scope) ? this.kept.report : null;
	}

	set(scope: OpponentScope, report: AdvancedReport): void {
		this.kept = { key: scopeKey(scope), report };
	}
}

/** What makes two reports the same report: the player, the colour and the dates. */
export function scopeKey(scope: OpponentScope): string {
	return `${scope.fideId}|${scope.color}|${scope.from}|${scope.to}`;
}
