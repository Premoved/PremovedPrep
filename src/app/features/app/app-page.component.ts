import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DesktopAppLogoComponent } from '../../shared/logo/desktop-app-logo.component';
import { SignedOutNoticeComponent } from '../../shared/signed-out/signed-out-notice.component';
import { AuthService } from '../../core/services/auth.service';
import { DesktopAppApiService } from '../../core/services/desktop-app.service';
import { AppStage, DesktopAppAccess } from '../../core/models/user.model';
import { environment } from '../../../environments/environment';

interface Download {
	readonly platform: string;
	readonly detail: string;
	readonly url: string;
}

interface Showcase {
	readonly title: string;
	readonly text: string;
	readonly image: string;
}

@Component({
	selector: 'app-app-page',
	imports: [DesktopAppLogoComponent, SignedOutNoticeComponent],
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

	readonly downloads: readonly Download[] = environment.desktopApp.builds.map((build) => ({
		platform: build.platform,
		detail: build.detail,
		url: `${environment.desktopApp.releasesUrl}/latest/download/${build.file}`,
	}));

	readonly suggested = computed(() => this.downloads.find((build) => build.platform === detectPlatform()) ?? null);
	readonly others = computed(() => this.downloads.filter((build) => build !== this.suggested()));

	readonly released = computed(() => (this.access()?.stage ?? this.stage()) === 'LAUNCHED');
	readonly mayDownload = computed(() => this.access()?.allowed === true);

	readonly showContent = computed(() => this.released() || this.mayDownload());

	readonly showcase: readonly Showcase[] = [
		{
			title: 'Local Resources',
			text: 'Select a local folder for saving your collections, use Stockfish or any other UCI engine you add, and index your own PGN databases on your computer.',
			image: 'showcase/local-resources.webp',
		},
		{
			title: 'Cloud and local, kept in sync',
			text: 'All your collections in one place. Choose which collections to keep in cloud, which to keep on your own computer, and which to keep synced between both.',
			image: 'showcase/library.webp',
		},
		{
			title: 'Offline workstation',
			text: 'Use the app without an account and completely offline with your own local resources.',
			image: 'showcase/offline-workstation.webp',
		},
		{
			title: 'Prepare against opponents',
			text: 'Use any setup you like to prepare against your opponents and access the cloud database any time.',
			image: 'showcase/prepare-against-opponents.webp',
		},
	];

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
			untracked(() => {
				this.api.access().subscribe({
					next: (access) => this.access.set(access),
					error: () => this.access.set(null),
				});
			});
		});
	}
}

function detectPlatform(): string | null {
	if (typeof navigator === 'undefined') {
		return null;
	}
	const agent = `${navigator.userAgent} ${navigator.platform ?? ''}`;
	if (/Win/i.test(agent)) return 'Windows';
	if (/Mac/i.test(agent)) return 'macOS';
	if (/Linux|X11/i.test(agent) && !/Android/i.test(agent)) return 'Linux';
	return null;
}
