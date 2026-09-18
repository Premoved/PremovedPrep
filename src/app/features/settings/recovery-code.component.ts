import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { PasswordRevealDirective } from '../../shared/password-reveal/password-reveal.directive';
import { saveBlob } from '../../core/browser/download';

/**
 * The recovery code: the only screen that ever shows one, and the last that can.
 *
 * WHY IT OPENS BY ITSELF
 *
 * An account registers with a recovery code nobody sees - it is made in the registering tab and
 * cannot survive the trip through the inbox, and keeping it in between would mean storing the one
 * thing that must never be stored. The first sign-in replaces it with a real one, and this dialog is
 * waiting when the person lands. After that it opens only when they ask for a new code.
 *
 * WHY THERE IS A PASSWORD STEP
 *
 * Generating a new code mints a credential that decrypts the whole account on its own, without the
 * password. A session alone should not be able to walk away with one, so the password is asked for
 * and re-derived - and the server checks it, rather than this dialog deciding for itself.
 */
@Component({
	selector: 'app-recovery-code',
	standalone: true,
	imports: [PasswordRevealDirective],
	templateUrl: './recovery-code.component.html',
	styleUrl: './recovery-code.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecoveryCodeComponent {
	private readonly auth = inject(AuthService);
	private readonly notices = inject(NotificationService);

	/** Set the moment a code exists and unset only when the person says they have kept it. */
	readonly code = this.auth.pendingRecoveryCode;

	/** True while the password is being asked for, before there is a code to show. */
	readonly asking = signal(false);

	readonly password = signal('');
	readonly error = signal<string | null>(null);
	readonly busy = signal(false);

	readonly kept = signal(false);

	readonly open = computed(() => this.asking() || this.code() !== null);

	readonly canGenerate = computed(() => this.password().length > 0 && !this.busy());

	/** Called from the profile's "Generate new" link. */
	startGenerating(): void {
		this.password.set('');
		this.error.set(null);
		this.kept.set(false);
		this.asking.set(true);
	}

	onPassword(event: Event): void {
		this.password.set((event.target as HTMLInputElement).value);
		this.error.set(null);
	}

	onKept(event: Event): void {
		this.kept.set((event.target as HTMLInputElement).checked);
	}

	generate(event: Event): void {
		event.preventDefault();
		if (!this.canGenerate()) {
			return;
		}

		this.busy.set(true);
		this.auth.replaceRecoveryCode(this.password()).subscribe({
			next: () => {
				/** The code reaches the template through the service; nothing is held here. */
				this.busy.set(false);
				this.asking.set(false);
				this.password.set('');
			},
			error: (err: Error) => {
				this.busy.set(false);
				this.error.set(err.message);
			},
		});
	}

	async copy(): Promise<void> {
		const code = this.code();
		if (code === null) {
			return;
		}

		try {
			await navigator.clipboard.writeText(code);
			this.notices.info('Recovery code copied');
		} catch {
			/** Denied, or an insecure context. It is on the screen and can be written down. */
			this.notices.error('This browser would not let the page copy. Write the code down instead.');
		}
	}

	/** A text file, because a password manager is not where everyone keeps things. */
	download(): void {
		const code = this.code();
		if (code === null) {
			return;
		}

		const body = [
			'PremovedPrep recovery code',
			'',
			`Account: ${this.auth.currentUser()?.email ?? ''}`,
			`Code:    ${code}`,
			'',
			'Your pgn files are encrypted before they are saved in cloud. If you ever forget your',
			'password and are logged out from all devices, you will need this code when resetting',
			'your password to recover your pgn files.',
			'',
			'It is not stored anywhere else. PremovedPrep cannot show it to you again.',
			'',
		].join('\n');

		saveBlob(new Blob([body], { type: 'text/plain' }), 'premovedprep-recovery-code.txt');
	}

	done(): void {
		if (!this.kept()) {
			return;
		}

		this.busy.set(true);
		void this.auth
			.acknowledgeRecoveryCode()
			.catch(() => {
				/**
				 * The record that it was seen did not save. Not worth an error in front of the person -
				 * the code is theirs either way - and the next sign-in will simply offer another one.
				 */
			})
			.finally(() => {
				this.busy.set(false);
				this.kept.set(false);
			});
	}

	/** Closing without keeping it is refused; there is no later. */
	dismiss(): void {
		if (this.code() === null) {
			this.asking.set(false);
		}
	}
}
