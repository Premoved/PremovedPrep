import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { LogoComponent } from '../../shared/logo/logo.component';
import { PasswordRevealDirective } from '../../shared/password-reveal/password-reveal.directive';
import { readRecoveryCode } from '../../core/crypto/recovery-code';
import { ResetContext } from '../../core/models/user.model';

@Component({
	selector: 'app-reset-password',
	standalone: true,
	imports: [RouterLink, LogoComponent, PasswordRevealDirective],
	templateUrl: './reset-password.component.html',
	styleUrl: './auth-form.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
/**
 * Resetting a password, which under end-to-end encryption is two different acts wearing one name.
 *
 * With the recovery code, the account's master key is opened with it here in the browser and
 * re-sealed under the new password; everything the account holds keeps working. Without it there is
 * no master key any more, and a new password gives the person their account back but not their
 * library - so the second path asks for that in as many words before it runs.
 *
 * Neither outcome can be softened by anything on the server. A reset that could hand the data back
 * would be a reset that proves the server could read it all along.
 */
export class ResetPasswordComponent {
	private readonly auth = inject(AuthService);
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	private readonly notices = inject(NotificationService);

	readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');

	constructor() {
		if (this.token().length > 0) {
			this.auth.resetContext(this.token()).subscribe({
				next: (context) => {
					this.context.set(context);
					this.recognised.set(this.auth.unlockedHere());
				},
				error: (err: Error) => this.error.set(err.message),
			});
		}
	}

	readonly password = signal('');
	readonly confirmation = signal('');

	/** Empty until the person types one. Empty and acknowledged is the destructive path. */
	readonly recoveryCode = signal('');
	readonly acceptsLoss = signal(false);

	/**
	 * Whose link this is, and the one wrap it can open. Fetched without spending the token, because a
	 * mail client following links to build a preview would otherwise burn it before the click.
	 */
	readonly context = signal<ResetContext | null>(null);

	/**
	 * True when this browser is already signed in and unlocked for the account the link is for. The
	 * key is here, so the new password can be wrapped around it directly and the code is not needed -
	 * and a field that is not needed is not shown.
	 */
	readonly recognised = signal(false);

	readonly checking = signal(false);
	readonly codeRejected = signal(false);
	readonly touchedPassword = signal(false);
	readonly touchedConfirmation = signal(false);

	readonly error = signal<string | null>(null);
	readonly submitting = signal(false);

	readonly passwordProblem = computed(() => {
		const value = this.password();
		if (value.length === 0) {
			return null;
		}
		/**
		 * The server is sent a derived secret and never sees the password, so BCrypt's 72-character
		 * ceiling no longer bounds what a person may choose, and no rule about it is checked over
		 * there. This is the rule.
		 */
		if (value.length > 200) {
			return 'At most 200 characters.';
		}
		return value.length < 8 ? 'At least 8 characters.' : null;
	});

	readonly confirmationProblem = computed(() => {
		if (this.confirmation().length === 0) {
			return null;
		}
		return this.confirmation() === this.password() ? null : 'The two do not match.';
	});

	readonly passwordHint = computed(() => (this.touchedPassword() ? (this.passwordProblem() ?? '') : ''));
	readonly confirmationHint = computed(() => (this.touchedConfirmation() ? (this.confirmationProblem() ?? '') : ''));

	/**
	 * What is wrong with the code, if anything.
	 *
	 * Two checks, and the second is the one that matters. The shape is refused as it is typed. Whether
	 * it is THIS account's code is settled cryptographically on submit - it either opens the recovery
	 * wrap or fails GCM's authentication tag, with no third outcome - so a mistyped code is refused
	 * before the link is spent, and can never be the reason a library is deleted.
	 */
	readonly recoveryCodeProblem = computed(() => {
		if (this.codeRejected()) {
			return 'Invalid recovery code';
		}
		const typed = this.recoveryCode().trim();
		if (typed.length === 0) {
			return null;
		}
		return readRecoveryCode(typed) === null ? 'Invalid recovery code' : null;
	});

	readonly hasRecoveryCode = computed(
		() => this.recoveryCode().trim().length > 0 && readRecoveryCode(this.recoveryCode().trim()) !== null,
	);

	/**
	 * Without a code, the only way on is to say out loud what happens. The box is always on screen -
	 * it is what the empty field means - but it is only required when the field is actually empty,
	 * and it is not shown at all on a browser that already holds the key.
	 */
	readonly mustAcceptLoss = computed(() => !this.recognised() && this.recoveryCode().trim().length === 0);

	readonly canSubmit = computed(
		() =>
			this.token().length > 0 &&
			this.password().length >= 8 &&
			this.passwordProblem() === null &&
			this.confirmationProblem() === null &&
			this.confirmation().length > 0 &&
			this.recoveryCodeProblem() === null &&
			(this.recognised() || this.hasRecoveryCode() || this.acceptsLoss()) &&
			!this.submitting() &&
			!this.checking(),
	);

	onRecoveryCode(event: Event): void {
		this.recoveryCode.set((event.target as HTMLInputElement).value);
		/** A rejection belongs to the value that was rejected, not to the field. */
		this.codeRejected.set(false);
	}

	onAcceptsLoss(event: Event): void {
		this.acceptsLoss.set((event.target as HTMLInputElement).checked);
	}

	onPassword(event: Event): void {
		this.password.set((event.target as HTMLInputElement).value);
	}

	onConfirmation(event: Event): void {
		this.confirmation.set((event.target as HTMLInputElement).value);
	}

	submit(event: Event): void {
		event.preventDefault();
		if (!this.canSubmit()) {
			return;
		}
		void this.send();
	}

	/**
	 * The code is proved before the link is spent.
	 *
	 * Order matters here more than anywhere else in the application: verifying afterwards would mean
	 * a transposed character had already consumed the token and deleted the account's files, and
	 * there would be nothing left to apologise with.
	 */
	private async send(): Promise<void> {
		this.error.set(null);
		const typed = this.recoveryCode().trim();
		const context = this.context();

		let code: string | null = null;
		if (!this.recognised() && typed.length > 0 && context !== null) {
			this.checking.set(true);
			const correct = await this.auth.verifyRecoveryCode(typed, context);
			this.checking.set(false);

			if (!correct) {
				this.codeRejected.set(true);
				return;
			}
			code = typed;
		}

		this.submitting.set(true);
		this.auth.resetPassword(this.token(), this.password(), code).subscribe({
			next: () => {
				this.notices.info('Your password has been changed');
				this.router.navigateByUrl('/login');
			},
			error: (err: Error) => {
				this.error.set(err.message);
				this.submitting.set(false);
			},
		});
	}
}
