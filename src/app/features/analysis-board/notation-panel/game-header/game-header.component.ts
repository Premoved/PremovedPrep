import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { formatGameDate, hasGameHeaders } from '../../../../core/chess/game-headers';
import { MoveTreeStore } from '../../state/move-tree.store';
import { ArchiveNameService } from '../../../../core/services/archive-name.service';

@Component({
	selector: 'app-game-header',
	standalone: true,
	imports: [],
	templateUrl: './game-header.component.html',
	styleUrl: './game-header.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameHeaderComponent {
	/** What the strip below the tab is naming: the game, or the database. */
	readonly scope = input<'game' | 'database'>('game');

	readonly tree = inject(MoveTreeStore);

	readonly archive = inject(ArchiveNameService);

	readonly hasHeaders = computed(() => hasGameHeaders(this.tree.headers()));

	readonly date = computed(() => formatGameDate(this.tree.headers().date));
}
