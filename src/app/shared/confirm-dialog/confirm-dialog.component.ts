import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { ConfirmService } from '../../core/services/confirm.service';

@Component({
	selector: 'app-confirm-dialog',
	standalone: true,
	imports: [],
	templateUrl: './confirm-dialog.component.html',
	styleUrl: './confirm-dialog.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
	readonly confirm = inject(ConfirmService);

	private readonly anchorRect = signal<DOMRect | null>(null);

	readonly anchorStyle = computed(() => {
		const rect = this.anchorRect();
		if (!rect) {
			return null;
		}
		return { left: `${rect.left + rect.width / 2}px`, top: `${rect.top + rect.height / 2}px` };
	});

	constructor() {
		effect(() => {
			if (this.confirm.request()) {
				const board = document.querySelector('.board-pane');
				this.anchorRect.set(board?.getBoundingClientRect() ?? null);
			}
		});
	}

	answer(value: boolean): void {
		this.confirm.answer(value);
	}

	@HostListener('document:keydown.escape')
	onEscape(): void {
		if (this.confirm.request()) {
			this.answer(false);
		}
	}
}
