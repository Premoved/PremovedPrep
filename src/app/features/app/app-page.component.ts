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

/** One frame of the screenshot strip. `image` is relative to the base href, from public/plan. */
interface Showcase {
	readonly title: string;
	readonly text: string;
	readonly image: string;
}

/** What the "Your plan" line says. `tone` colours the dot. */
interface PlanLine {
	readonly label: string;
	readonly detail: string | null;
	readonly tone: 'on' | 'off';
}

/** Shown until the server's prices arrive, and if they never do. The same as the app's. */
const DEFAULT_PRICES = { monthly: 124, yearly: 1199, currency: 'EUR' };

/**
 * Desktop app page: what the application is, the downloads, what it looks like, and the plan it runs
 * on.
 *
 * The plan is presented here and bought in the application. That is the one thing this page must
 * not leave unclear: the website is free and asks for nothing, and the Premoved Plan belongs to the
 * Desktop App - its free trial and its payment both start from the app's Subscription Plan page.
 * So there are no buttons to buy anything here, only the way to get the app and a plain statement
 * of where the plan lives. The one billing action is the opposite one: an active plan that was paid
 * for can be cancelled from the "Your plan" line.
 *
 * A signed-out visitor sees the sign-in notice, whatever the stage. Signed in, the page has two
 * states: the presentation and the downloads, or "Coming soon".
 */
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

	/** The release's own asset URLs. A new build changes the file behind them, not the page. */
	readonly downloads: readonly Download[] = environment.desktopApp.builds.map((build) => ({
		platform: build.platform,
		detail: build.detail,
		url: `${environment.desktopApp.releasesUrl}/latest/download/${build.file}`,
	}));

	/** The build for the system this browser runs on, offered first; the rest beside it. */
	readonly suggested = computed(() => this.downloads.find((build) => build.platform === detectPlatform()) ?? null);
	readonly others = computed(() => this.downloads.filter((build) => build !== this.suggested()));

	/**
	 * The stage as this account sees it when signed in - LAUNCHED for a tester while the deployment
	 * is still in preview - and the deployment's otherwise.
	 */
	readonly released = computed(() => (this.access()?.stage ?? this.stage()) === 'LAUNCHED');
	readonly mayDownload = computed(() => this.access()?.allowed === true);

	/**
	 * For a signed-in account the page has two states and nothing between them. Launched, every
	 * account sees the presentation and the downloads, with a plan or not: the application asks for
	 * the plan itself, and the site never does. Before the launch, only the accounts the server
	 * already lets in see them; every other account sees "Coming soon". Signed out is neither - the
	 * template shows the sign-in notice before it asks this.
	 */
	readonly showContent = computed(() => this.released() || this.mayDownload());

	readonly monthly = computed(() => this.price(this.plan()?.monthlyPriceMinor ?? DEFAULT_PRICES.monthly));
	readonly yearly = computed(() => this.price(this.plan()?.yearlyPriceMinor ?? DEFAULT_PRICES.yearly));

	/** What the yearly price saves against twelve months, rounded down so it never overstates. */
	readonly saving = computed(() => {
		const monthly = this.plan()?.monthlyPriceMinor ?? DEFAULT_PRICES.monthly;
		const yearly = this.plan()?.yearlyPriceMinor ?? DEFAULT_PRICES.yearly;
		const percent = Math.floor((1 - yearly / (monthly * 12)) * 100);
		return percent > 0 ? percent : null;
	});

	/** The same line the app's Subscription Plan page shows, read from the same answer. */
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

	/**
	 * Whether the "Your plan" line offers to cancel: an active plan that was paid for through Stripe
	 * and is not already ending. A trial, a granted plan and a plan already cancelled have nothing to
	 * cancel here.
	 */
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

	/** The same five pictures, titles and texts as the app's Subscription Plan page. Change both together. */
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

	/** The screenshot shown enlarged, or null. Opened by clicking one, closed by the backdrop or Escape. */
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
				/** For the line, the prices and whether the plan can be cancelled from here. */
				this.auth.subscription().subscribe({
					next: (plan) => this.plan.set(plan),
					error: () => undefined,
				});
			});
		});
	}

	/**
	 * Cancels the plan at the end of the period paid for, after asking. Nothing is refunded and
	 * nothing is cut short: the line then says when the plan ends.
	 */
	async cancelPlan(): Promise<void> {
		const view = this.plan();
		if (!view || this.cancelling()) {
			return;
		}
		/**
		 * Two different cancellations, and the question says which one this is: within fourteen days
		 * of the first payment the plan ends now and the payment comes back; after that it runs to the
		 * end of the period paid for.
		 */
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

	/** Left and right step through the pictures while one is enlarged, wrapping round at the ends. */
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

	/** What the account paid for the period it is in, by its interval. */
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

/** Which of the builds' platforms this browser is on, as the builds name them. */
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
