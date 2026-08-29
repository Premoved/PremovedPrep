import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Claims the <piece> tag so Angular recognises it as a known element. */
@Component({
	selector: 'piece',
	standalone: true,
	template: '',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PieceComponent {}
