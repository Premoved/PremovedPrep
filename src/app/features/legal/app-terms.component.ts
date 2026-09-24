import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The Desktop App's Terms and Conditions, reproduced for readers who have not installed it. The
 * wording must match PremovedPrep-App/src/app/features/legal/terms.component.html; only the
 * heading, the lead paragraph and the third-party link differ, because that route is app-only.
 */
@Component({
	selector: 'app-app-terms',
	standalone: true,
	imports: [RouterLink],
	templateUrl: './app-terms.component.html',
	styleUrl: './legal-page.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppTermsComponent {}
