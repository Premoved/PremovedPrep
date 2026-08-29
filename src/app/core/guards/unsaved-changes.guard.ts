import { CanDeactivateFn } from '@angular/router';
// Type-only, so the guard does not pull the analysis board into the initial bundle.
import type { AnalysisBoardComponent } from '../../features/analysis-board/analysis-board.component';

export const unsavedChangesGuard: CanDeactivateFn<AnalysisBoardComponent> = (component) => {
	return component.confirmDiscardOrSave();
};
