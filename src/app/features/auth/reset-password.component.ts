import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { LogoComponent } from '../../shared/logo/logo.component';

@Component({
	selector: 'app-reset-password',
	standalone: true,
	imports: [RouterLink, LogoComponent],
	templateUrl: './reset-password.component.html',
	styleUrl: './auth-form.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordComponent {
	private readonly auth = inject(AuthService);
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	private readonly notices = inject(NotificationService);

	readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');

	readonly password = signal('');
	readonly confirmation = signal('');
	readonly touchedPassword = signal(false);
	readonly touchedConfirmation = signal(false);

	readonly error = signal<string | null>(null);
	readonly submitting = signal(false);

	readonly passwordProblem = computed(() => {
		const value = this.password();
		if (value.length === 0) {
			return null;
		}
		/** 72 is BCrypt's ceiling: anything longer is silently truncated. */
		if (value.length > 72) {
			return 'At most 72 characters.';
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

	readonly canSubmit = computed(
		() =>
			this.token().length > 0 &&
			this.password().length >= 8 &&
			this.passwordProblem() === null &&
			this.confirmationProblem() === null &&
			this.confirmation().length > 0 &&
			!this.submitting(),
	);

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

		this.error.set(null);
		this.submitting.set(true);

		this.auth.resetPassword(this.token(), this.password()).subscribe({
			next: () => {
				this.notices.info('Your password has been changed. Sign in with the new one.');
				this.router.navigateByUrl('/login');
			},
			error: (err: Error) => {
				this.error.set(err.message);
				this.submitting.set(false);
			},
		});
	}
}
