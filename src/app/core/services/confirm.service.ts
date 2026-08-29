import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
	readonly message: string;
	readonly confirmLabel: string;
	readonly cancelLabel: string;
	readonly danger: boolean;
	readonly resolve: (value: boolean) => void;
}

export interface ConfirmOptions {
	readonly confirmLabel?: string;
	readonly cancelLabel?: string;
	readonly danger?: boolean;
}

/** Replaces window.confirm with a styled dialog. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
	readonly request = signal<ConfirmRequest | null>(null);

	ask(message: string, options: ConfirmOptions = {}): Promise<boolean> {
		/** A second question while one is open resolves the first as false. */
		this.request()?.resolve(false);

		return new Promise<boolean>((resolve) => {
			this.request.set({
				message,
				confirmLabel: options.confirmLabel ?? 'OK',
				cancelLabel: options.cancelLabel ?? 'Cancel',
				danger: options.danger ?? false,
				resolve,
			});
		});
	}

	answer(value: boolean): void {
		this.request()?.resolve(value);
		this.request.set(null);
	}
}
