import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LogoComponent } from '../../shared/logo/logo.component';
import { NotificationService } from '../../core/services/notification.service';
import { saveBlob } from '../../core/browser/download';

/**
 * The one screen that shows a recovery code, and the last one that ever can.
 *
 * WHY IT IS A WHOLE SCREEN
 *
 * The code was generated in this browser and sent nowhere. There is no copy on the server, because a
 * copy on the server would be a way for the server to open the account - which is the thing this
 * whole design removes. So if it is lost and the password is later forgotten, everything the account
 * holds becomes permanently unreadable, by everyone.
 *
 * That is a large consequence for a line of text, and a line of text on a page somebody is trying to
 * get past is a line of text nobody reads. Hence a screen with one thing on it, a checkbox that has
 * to be ticked, and no way onward that does not involve saying you have it.
 *
 * It is reached by router state rather than by a query parameter or a service: a code in a URL is a
 * code in the history, in the referrer, and in whatever the browser syncs.
 */
@Component({
	selector: 'app-recovery-code',
	standalone: true,
	imports: [LogoComponent, RouterLink],
	templateUrl: './recovery-code.component.html',
	styleUrl: './auth-form.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecoveryCodeComponent {
	private readonly router = inject(Router);
	private readonly notices = inject(NotificationService);

	private readonly state = this.router.getCurrentNavigation()?.extras.state ?? history.state ?? {};

	readonly code = signal<string>(typeof this.state['recoveryCode'] === 'string' ? this.state['recoveryCode'] : '');
	readonly email = signal<string>(typeof this.state['email'] === 'string' ? this.state['email'] : '');

	readonly written = signal(false);

	/**
	 * Arriving here without a code means a reload, or a link somebody pasted. There is nothing to
	 * show and nothing to recover - the code is gone - so the screen says so plainly instead of
	 * showing an empty box.
	 */
	readonly missing = computed(() => this.code().length === 0);

	readonly canContinue = computed(() => this.written() && !this.missing());

	onWritten(event: Event): void {
		this.written.set((event.target as HTMLInputElement).checked);
	}

	async copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.code());
			this.notices.info('Recovery code copied. Paste it somewhere it will still be there in a year.');
		} catch {
			/** Denied, or an insecure context. The code is on the screen and can be written down. */
			this.notices.error('This browser would not let the page copy. Write the code down instead.');
		}
	}

	/** A text file, because a password manager is not where everyone keeps things. */
	download(): void {
		const body = [
			'PremovedPrep recovery code',
			'',
			`Account: ${this.email()}`,
			`Code:    ${this.code()}`,
			'',
			'This code is the only way to reach your saved games and repertoires if you forget your',
			'password. It was created in your browser and was never sent to PremovedPrep, so nobody',
			'there can look it up or send it to you again. Keep it somewhere you will still have it',
			'in a year.',
			'',
		].join('\n');

		saveBlob(new Blob([body], { type: 'text/plain' }), 'premovedprep-recovery-code.txt');
	}

	continue(): void {
		if (!this.canContinue()) {
			return;
		}
		this.router.navigateByUrl('/verify-email', { state: { email: this.email() } });
	}
}
