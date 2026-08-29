import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Static text. The publication date has to match AccountService.TERMS_VERSION on the server. */
@Component({
	selector: 'app-privacy',
	standalone: true,
	imports: [RouterLink],
	templateUrl: './privacy.component.html',
	styleUrl: './legal-page.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyComponent {}
