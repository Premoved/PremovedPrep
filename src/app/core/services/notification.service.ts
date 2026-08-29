import { Injectable, signal } from '@angular/core';

export type NoticeKind = 'error' | 'info';

export interface Notice {
	readonly id: number;
	readonly kind: NoticeKind;
	readonly message: string;
}

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
		this.items.update((list) => [...list, { id, kind, message: text }]);

		/** No NgZone: the application is zoneless, so the signal write is what schedules the re-render. */
		setTimeout(() => this.dismiss(id), timeoutMs);
	}
}
