import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { AgentBridgeService, SEARCH_WINDOW_MS } from '../../core/agent/agent-bridge.service';
import { AgentSelectionStore } from '../../core/agent/agent-selection.store';
import { AgentKeysStore } from '../../core/agent/agent-keys.store';
import { AgentAccessStore } from '../../core/agent/agent-access.store';
import { AgentKeySummary, NewAgentKey } from '../../core/agent/agent.models';
import { DesktopAgentLogoComponent } from '../../shared/logo/desktop-agent-logo.component';
import { KnightLogoComponent } from '../../shared/logo/knight-logo.component';
import { QueenLogoComponent } from '../../shared/logo/queen-logo.component';
import { KingLogoComponent } from '../../shared/logo/king-logo.component';
import { AuthService } from '../../core/services/auth.service';
import { SubscriptionView } from '../../core/models/user.model';
import { SignedOutNoticeComponent } from '../../shared/signed-out/signed-out-notice.component';
import { NotificationService } from '../../core/services/notification.service';
import { copyText } from '../../core/browser/clipboard';
import { ApiError } from '../../core/interceptors/error.interceptor';

/** Desktop agent page: pair a machine, then choose what the site uses from it. */
@Component({
	selector: 'app-agent-page',
	imports: [
		FormsModule,
		DatePipe,
		DecimalPipe,
		DesktopAgentLogoComponent,
		KnightLogoComponent,
		QueenLogoComponent,
		KingLogoComponent,
		SignedOutNoticeComponent,
	],
	templateUrl: './agent-page.component.html',
	styleUrl: './agent-page.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentPageComponent {
	readonly bridge = inject(AgentBridgeService);
	readonly selection = inject(AgentSelectionStore);
	readonly keys = inject(AgentKeysStore);
	readonly access = inject(AgentAccessStore);
	readonly auth = inject(AuthService);

	readonly plan = signal<SubscriptionView | null>(null);

	readonly entitled = computed(() => this.plan()?.entitled ?? true);

	readonly price = computed(() => {
		const subscription = this.plan();
		return subscription ? `${subscription.currency} ${(subscription.priceMinor / 100).toFixed(2)}` : '';
	});

	readonly gate = computed<'agent' | 'preview' | 'plan' | 'signed-out'>(() => {
		if (!this.auth.isLoggedIn()) {
			return 'signed-out';
		}
		const decision = this.access.access();
		if (decision) {
			if (decision.allowed) {
				return 'agent';
			}
			return decision.reason === 'PREVIEW' ? 'preview' : 'plan';
		}
		return this.entitled() ? 'agent' : 'plan';
	});
	private readonly notify = inject(NotificationService);

	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	readonly secondsLeft = signal<number | null>(null);

	readonly searchSeconds = Math.round(SEARCH_WINDOW_MS / 1000);

	readonly folderPath = computed(() => this.bridge.backup()?.root ?? null);
	readonly folderExists = computed(() => this.bridge.backup()?.exists === true);

	readonly freshKey = signal<NewAgentKey | null>(null);

	newLabel = '';

	readonly liveKeys = this.keys.live;
	readonly revokedKeys = this.keys.revoked;

	readonly connectedKeyId = computed<number | null>(() => {
		const session = this.bridge.session();
		if (!session) {
			return null;
		}
		if (session.keyId > 0) {
			return session.keyId;
		}
		const byLabel = this.liveKeys().filter((key) => key.label === session.keyLabel);
		return byLabel.length === 1 ? byLabel[0].id : null;
	});

	isThisComputer(key: AgentKeySummary): boolean {
		return this.connectedKeyId() === key.id;
	}

	readonly headline = computed(() => {
		switch (this.bridge.state()) {
			case 'connected':
				return 'Connected to this computer.';
			case 'connecting':
				return 'Connecting…';
			case 'searching': {
				const left = this.secondsLeft();
				return left === null ? 'Looking for the agent…' : `Looking for the agent — ${left}s`;
			}
			case 'unpaired':
				return 'The agent is running and has not been paired yet.';
			case 'refused':
				return 'The agent on this computer belongs to a different account.';
			case 'offline':
				return 'No agent answered on this computer.';
			case 'unlinked':
				return 'No computer is linked to your account yet.';
			default:
				return 'Sign in to use a Desktop Agent.';
		}
	});

	readonly canSearch = computed(() => {
		const state = this.bridge.state();
		return state !== 'searching' && state !== 'connecting' && state !== 'unlinked' && state !== 'idle';
	});

	constructor() {
		this.keys.load();

		if (this.auth.isLoggedIn()) {
			this.auth.subscription().subscribe({
				next: (view) => this.plan.set(view),
				error: () => this.plan.set(null),
			});
		}

		/** Search countdown. */
		effect((onCleanup) => {
			const until = this.bridge.searchUntil();
			if (until === null) {
				this.secondsLeft.set(null);
				return;
			}

			const tick = () => this.secondsLeft.set(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
			tick();
			const timer = setInterval(tick, 250);
			onCleanup(() => clearInterval(timer));
		});
	}

	openPlan(): void {
		this.notify.info('Plans are not open yet. Everything on the site stays free in the meantime.');
	}

	retry(): void {
		void this.bridge.connect(true);
	}

	refreshLists(): void {
		void this.bridge.refresh();
	}

	generate(): void {
		if (this.busy()) {
			return;
		}
		this.busy.set(true);
		this.error.set(null);

		this.keys.create(this.newLabel.trim()).subscribe({
			next: (created) => {
				this.freshKey.set(created);
				this.newLabel = '';
				this.busy.set(false);
			},
			error: (e: Error) => {
				this.busy.set(false);
				/** 402 means no active plan, not a failure. */
				const denied = e instanceof ApiError && e.status === 402;
				this.error.set(
					denied
						? this.access.preview()
							? 'The Desktop agent is not out yet — this page will let you link a computer when the ' +
								'beta opens. Nothing else on the site is affected.'
							: 'Linking a computer needs an active plan. The site, the board and the database ' +
								'stay free — and so does the agent; what a plan buys is the connection between them.'
						: e.message,
				);
			},
		});
	}

	copyKey(): void {
		const key = this.freshKey();
		if (!key) {
			return;
		}
		void copyText(key.key).then((copied) =>
			this.notify.info(
				copied
					? 'Access key copied. Paste it into the agent.'
					: 'Could not copy automatically - select the key and copy it.',
			),
		);
	}

	dismissKey(): void {
		this.freshKey.set(null);
	}

	revoke(key: AgentKeySummary): void {
		const thisComputer = this.isThisComputer(key);

		this.keys.revoke(key.id).subscribe({
			next: () => {
				if (thisComputer) {
					/** Order matters: the key is already revoked server-side. */
					void this.bridge.unpair();
					this.notify.info(`"${key.label}" unlinked. This computer is no longer connected.`);
					return;
				}
				this.notify.info(
					`"${key.label}" unlinked. If that computer is running it disconnects within a minute; ` +
						`if it is off, the moment it starts.`,
				);
			},
			error: (e: Error) => this.error.set(e.message),
		});
	}

	size(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
		return `${rounded} ${units[unit]}`;
	}

	moves(ply: number): number {
		return Math.floor(ply / 2);
	}

	indexedTo(maxPly: number): string {
		return maxPly > 0 ? `move ${this.moves(maxPly)}` : 'every move';
	}
}
