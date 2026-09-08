import { Injectable, signal } from '@angular/core';
import { SIGN_IN_REQUIRED } from '../interceptors/error.interceptor';

export type NoticeKind = 'error' | 'info';

/** A link offered alongside the message. Opened in a new tab, so whatever is on this page survives. */
export interface NoticeAction {
	readonly label: string;
	readonly href: string;
}

export interface Notice {
	readonly id: number;
	readonly kind: NoticeKind;
	readonly message: string;
	readonly action?: NoticeAction;
}

const SIGN_IN: NoticeAction = { label: 'Sign in', href: '/login' };

const ERROR_MS = 9000;
const INFO_MS = 4500;

/** Single exit point for user-facing messages. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
	private nextId = 1;
	private readonly items = signal<readonly Notice[]>([]);

	readonly notices = this.items.asReadonly();

	error(message: string): void {
		this.push('error', message, ERROR_MS);
	}

	info(message: string): void {
		this.push('info', message, INFO_MS);
	}

	dismiss(id: number): void {
		this.items.update((list) => list.filter((notice) => notice.id !== id));
	}

	private push(kind: NoticeKind, message: string, timeoutMs: number): void {
		const text = message?.trim() ? message.trim() : 'Something went wrong. Please try again.';
		if (this.items().some((notice) => notice.kind === kind && notice.message === text)) {
			return;
		}

		const id = this.nextId++;
		/**
		 * Attached here rather than at each call site: every 401 in the application arrives as this
		 * one string, and there are dozens of places that show it. The alternative was passing an
		 * action through every caller for the sake of a single case.
		 */
		const action = text === SIGN_IN_REQUIRED ? SIGN_IN : undefined;
		this.items.update((list) => [...list, { id, kind, message: text, action }]);

		/** No NgZone: the application is zoneless, so the signal write is what schedules the re-render. */
		setTimeout(() => this.dismiss(id), timeoutMs);
	}
}
