import {
	ChangeDetectionStrategy,
	Component,
	HostListener,
	computed,
	effect,
	inject,
	signal,
	untracked,
} from '@angular/core';
import { DesktopAppLogoComponent } from '../../shared/logo/desktop-app-logo.component';
import { PlanIconComponent } from '../../shared/logo/plan-icon.component';
import { SignedOutNoticeComponent } from '../../shared/signed-out/signed-out-notice.component';
import { AuthService } from '../../core/services/auth.service';
import { BillingService } from '../../core/services/billing.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { NotificationService } from '../../core/services/notification.service';
import { DesktopAppApiService } from '../../core/services/desktop-app.service';
import { AppStage, DesktopAppAccess, SubscriptionView } from '../../core/models/user.model';
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

interface PlanLine {
	readonly label: string;
	readonly detail: string | null;
	readonly tone: 'on' | 'off';
}

const DEFAULT_PRICES = { monthly: 124, yearly: 1199, currency: 'EUR' };

@Component({
	selector: 'app-app-page',
	imports: [DesktopAppLogoComponent, PlanIconComponent, SignedOutNoticeComponent],
	templateUrl: './app-page.component.html',
	styleUrl: './app-page.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppPageComponent {
	private readonly api = inject(DesktopAppApiService);
	readonly auth = inject(AuthService);
	private readonly billing = inject(BillingService);
	private readonly confirm = inject(ConfirmService);
	private readonly notify = inject(NotificationService);

	readonly stage = signal<AppStage | null>(null);
	readonly access = signal<DesktopAppAccess | null>(null);
	readonly plan = signal<SubscriptionView | null>(null);

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

	readonly monthly = computed(() => this.price(this.plan()?.monthlyPriceMinor ?? DEFAULT_PRICES.monthly));
	readonly yearly = computed(() => this.price(this.plan()?.yearlyPriceMinor ?? DEFAULT_PRICES.yearly));

	readonly saving = computed(() => {
		const monthly = this.plan()?.monthlyPriceMinor ?? DEFAULT_PRICES.monthly;
		const yearly = this.plan()?.yearlyPriceMinor ?? DEFAULT_PRICES.yearly;
		// Floor so the displayed saving never overstates the actual discount.
		const percent = Math.floor((1 - yearly / (monthly * 12)) * 100);
		return percent > 0 ? percent : null;
	});

	readonly line = computed<PlanLine | null>(() => {
		if (!this.auth.isLoggedIn()) {
			return null;
		}
		const view = this.plan();
		if (!view) {
			return { label: 'Unknown', detail: null, tone: 'off' };
		}
		const trialEnds = view.trialEndsAt ? new Date(view.trialEndsAt) : null;
		const onTrial = view.active && view.renewsAt === null && trialEnds !== null && trialEnds.getTime() > Date.now();
		if (onTrial && view.trialEndsAt) {
			return { label: 'Free trial', detail: `ends on ${this.day(view.trialEndsAt)}`, tone: 'on' };
		}
		if (!view.active) {
			return { label: 'No plan', detail: null, tone: 'off' };
		}
		if (!view.renewsAt) {
			return { label: 'Active plan', detail: null, tone: 'on' };
		}
		const ending = view.cancelAtPeriodEnd || view.status === 'CANCELED';
		if (!ending && view.refundUntil) {
			return {
				label: 'Active plan',
				detail: `renews automatically on ${this.day(view.renewsAt)} · full refund if cancelled before ${this.day(view.refundUntil)}`,
				tone: 'on',
			};
		}
		return {
			label: 'Active plan',
			detail: `${ending ? 'ends on' : 'renews automatically on'} ${this.day(view.renewsAt)}`,
			tone: 'on',
		};
	});

	readonly canCancel = computed(() => {
		const view = this.plan();
		return (
			view !== null &&
			view.active &&
			view.managed &&
			view.renewsAt !== null &&
			!view.cancelAtPeriodEnd &&
			view.status !== 'CANCELED'
		);
	});

	readonly cancelling = signal(false);

	readonly showcase: readonly Showcase[] = [
		{
			title: 'Local Resources',
			text: 'Select a local folder for saving your collections, use Stockfish or any other UCI engine you add, and index any local PGN databases on your own computer.',
			image: 'plan/local-resources-indexed.webp',
		},
		{
			title: 'Cloud and local, kept in sync',
			text: 'All your collections in one place. Choose which collections to keep in cloud, which to keep on your own computer, and which to keep synced between both.',
			image: 'plan/collections.webp',
		},
		{
			title: 'Search your local databases offline',
			text: 'Use the advanced search by multiple criteria to query your local databases any time.',
			image: 'plan/database-search.webp',
		},
		{
			title: 'Advanced Report',
			text: 'Power your Advanced Reports and Search Opponent functions, using any selected local database and the main lines from all your repertoire collections.',
			image: 'plan/advanced-report.webp',
		},
		{
			title: 'Access the cloud resources any time',
			text: "Use any setup you like and query the site's cloud database any time",
			image: 'plan/analysis-board.webp',
		},
	];

	readonly zoomed = signal<number | null>(null);
	readonly zoomedShot = computed(() => {
		const at = this.zoomed();
		return at === null ? null : this.showcase[at];
	});

	constructor() {
		this.api.stage().subscribe({
			next: (answer) => this.stage.set(answer.stage),
			error: () => undefined,
		});

		effect(() => {
			if (!this.auth.isLoggedIn()) {
				this.access.set(null);
				this.plan.set(null);
				return;
			}
			untracked(() => {
				this.api.access().subscribe({
					next: (access) => this.access.set(access),
					error: () => this.access.set(null),
				});
				this.auth.subscription().subscribe({
					next: (plan) => this.plan.set(plan),
					error: () => undefined,
				});
			});
		});
	}

	async cancelPlan(): Promise<void> {
		const view = this.plan();
		if (!view || this.cancelling()) {
			return;
		}
		const refund = view.refundUntil
			? ` You are within 14 days of your first payment, so the plan ends now and the ${this.paidPrice(view)} you paid is refunded in full, automatically.`
			: '';
		const until =
			!refund && view.renewsAt ? ` It stays active until ${this.day(view.renewsAt)}, and will not renew.` : '';
		const sure = await this.confirm.ask(`Cancel your Premoved Plan?${refund}${until}`, {
			confirmLabel: 'Cancel subscription',
			cancelLabel: 'Keep my plan',
			danger: true,
		});
		if (!sure) {
			return;
		}
		this.cancelling.set(true);
		this.billing.cancel().subscribe({
			next: (updated) => {
				this.plan.set(updated);
				this.cancelling.set(false);
				this.notify.info(
					!updated.active
						? 'Your plan has been cancelled and your payment refunded. The refund can take a few days to appear.'
						: updated.renewsAt
							? `Your plan will end on ${this.day(updated.renewsAt)}.`
							: 'Your plan has been cancelled.',
				);
			},
			error: (error: Error) => {
				this.cancelling.set(false);
				this.notify.error(error.message);
			},
		});
	}

	zoom(index: number): void {
		this.zoomed.set(index);
	}

	closeZoom(): void {
		this.zoomed.set(null);
	}

	step(by: number): void {
		const at = this.zoomed();
		if (at !== null) {
			const count = this.showcase.length;
			this.zoomed.set((at + by + count) % count);
		}
	}

	@HostListener('document:keydown', ['$event'])
	onKey(event: KeyboardEvent): void {
		if (this.zoomed() === null) {
			return;
		}
		if (event.key === 'Escape') {
			this.closeZoom();
		} else if (event.key === 'ArrowRight') {
			this.step(1);
		} else if (event.key === 'ArrowLeft') {
			this.step(-1);
		} else {
			return;
		}
		event.preventDefault();
	}

	private paidPrice(view: SubscriptionView): string {
		return this.price(view.interval === 'YEAR' ? view.yearlyPriceMinor : view.monthlyPriceMinor);
	}

	private price(minor: number): string {
		const currency = this.plan()?.currency ?? DEFAULT_PRICES.currency;
		try {
			return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
		} catch {
			return `${(minor / 100).toFixed(2)} ${currency}`;
		}
	}

	private day(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
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
