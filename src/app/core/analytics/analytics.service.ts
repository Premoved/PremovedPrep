import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AnalyticsEventName } from './analytics.events';

type Props = Record<string, unknown>;

interface PostHog {
	init(key: string, config: Props): void;
	capture(event: string, properties?: Props): void;
	identify(distinctId: string, properties?: Props): void;
	reset(): void;
}

declare global {
	interface Window {
		posthog?: PostHog;
	}
}

const MAX_QUEUE = 50;

/**
 * Product analytics over PostHog's browser snippet. Loaded lazily; every method is a no-op without a
 * configured key.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
	private readonly router = inject(Router);

	private ph: PostHog | null = null;
	private disabled = false;
	private queue: ((ph: PostHog) => void)[] = [];
	private lastPath: string | null = null;

	init(): void {
		if (!environment.posthogKey) {
			this.disabled = true;
			if (environment.production) {
				console.warn('Analytics disabled: environment.posthogKey is empty.');
			}
			return;
		}

		const script = document.createElement('script');
		script.src = `${environment.posthogHost}/static/array.js`;
		script.async = true;
		/** Required by COEP: a cross-origin script only loads when requested in CORS mode. */
		script.crossOrigin = 'anonymous';
		script.onload = () => this.start();
		script.onerror = () => this.stop();
		document.head.appendChild(script);

		this.router.events.subscribe((event) => {
			if (event instanceof NavigationEnd) {
				this.pageView(event.urlAfterRedirects);
			}
		});
	}

	identify(userId: number | string, properties?: Props): void {
		this.run((ph) => ph.identify(String(userId), properties));
	}

	reset(): void {
		this.run((ph) => ph.reset());
	}

	capture(event: AnalyticsEventName, properties?: Props): void {
		this.run((ph) => ph.capture(event, properties));
	}

	/** Path only: query strings carry player names, FIDE ids and FENs. */
	private pageView(url: string): void {
		const path = url.split('?')[0].split('#')[0];
		if (path === this.lastPath) {
			return;
		}
		this.lastPath = path;
		this.run((ph) => ph.capture('$pageview', { $pathname: path }));
	}

	private start(): void {
		const ph = window.posthog;
		if (!ph) {
			this.stop();
			return;
		}
		ph.init(environment.posthogKey, {
			api_host: environment.posthogHost,
			capture_pageview: false,
			capture_pageleave: true,
			autocapture: false,
			disable_session_recording: true,
			persistence: 'localStorage+cookie',
		});
		this.ph = ph;
		const pending = this.queue;
		this.queue = [];
		for (const call of pending) {
			call(ph);
		}
	}

	private stop(): void {
		this.disabled = true;
		this.queue = [];
	}

	private run(call: (ph: PostHog) => void): void {
		if (this.disabled) {
			return;
		}
		if (this.ph) {
			call(this.ph);
			return;
		}
		if (this.queue.length < MAX_QUEUE) {
			this.queue.push(call);
		}
	}
}
