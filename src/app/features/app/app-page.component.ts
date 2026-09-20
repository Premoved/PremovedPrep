import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DesktopAppLogoComponent } from '../../shared/logo/desktop-app-logo.component';
import { AuthService } from '../../core/services/auth.service';
import { DesktopAppApiService } from '../../core/services/desktop-app.service';
import { AppStage, DesktopAppAccess } from '../../core/models/user.model';
import { environment } from '../../../environments/environment';

interface Download {
	readonly platform: string;
	readonly detail: string;
	readonly url: string;
}

/** Desktop app page: what the application is, and whether this account may download it yet. */
@Component({
	selector: 'app-app-page',
	imports: [RouterLink, DesktopAppLogoComponent],
	templateUrl: './app-page.component.html',
	styleUrl: './app-page.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppPageComponent {
	private readonly api = inject(DesktopAppApiService);
	readonly auth = inject(AuthService);

	readonly stage = signal<AppStage | null>(null);
	readonly access = signal<DesktopAppAccess | null>(null);

	readonly releasesUrl = environment.desktopApp.releasesUrl;
	readonly sourceUrl = environment.desktopApp.repoUrl;

	/** The release's own asset URLs. A new build changes the file behind them, not the page. */
	readonly downloads: readonly Download[] = environment.desktopApp.builds.map((build) => ({
		platform: build.platform,
		detail: build.detail,
		url: `${environment.desktopApp.releasesUrl}/latest/download/${build.file}`,
	}));

	readonly released = computed(() => this.stage() === 'LAUNCHED');
	readonly mayDownload = computed(() => this.access()?.allowed === true);

	constructor() {
		this.api.stage().subscribe({
			next: (answer) => this.stage.set(answer.stage),
			error: () => undefined,
		});

		effect(() => {
			if (!this.auth.isLoggedIn()) {
				this.access.set(null);
				return;
			}
			untracked(() =>
				this.api.access().subscribe({
					next: (access) => this.access.set(access),
					error: () => this.access.set(null),
				}),
			);
		});
	}
}
