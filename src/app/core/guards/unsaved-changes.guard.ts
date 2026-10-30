import { CanDeactivateFn } from '@angular/router';

// A shape rather than the pages themselves, so the guard pulls no page into the initial bundle.
export interface ConfirmsUnsavedChanges {
	/** Resolves true to leave (after saving or discarding), false to stay. */
	confirmDiscardOrSave(): Promise<boolean>;
}

export const unsavedChangesGuard: CanDeactivateFn<ConfirmsUnsavedChanges> = (component) => {
	return component.confirmDiscardOrSave();
};
