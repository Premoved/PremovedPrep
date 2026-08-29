import { Injectable } from '@angular/core';
import { AnalyticsEventName } from './analytics.events';

type Props = Record<string, unknown>;

/**
 * The instrumentation points, with no transport behind them.
 *
 * Product analytics is off, and off structurally rather than by an empty configuration value: the
 * built bundle contains no vendor script, no endpoint and no project key, so anyone can check the
 * claim in the privacy notice by searching the JavaScript the site actually serves. A key removed
 * from the source but still in the bundle would prove nothing, which is the whole reason this is a
 * deletion rather than a setting.
 *
 * The call sites stay because they mark what would be worth measuring. Turning measurement back on
 * means adding a transport here, asking for consent before it loads, recording that consent,
 * offering a way to withdraw it, and describing all of it in the privacy notice.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
	init(): void {
		/** Nothing to start. */
	}

	identify(userId: number | string, properties?: Props): void {
		/** Nobody is being identified to anybody. */
		void userId;
		void properties;
	}

	reset(): void {
		/** No identity to clear. */
	}

	capture(event: AnalyticsEventName, properties?: Props): void {
		/** Recorded nowhere, sent nowhere. The signature stays so the call sites keep type-checking. */
		void event;
		void properties;
	}
}
