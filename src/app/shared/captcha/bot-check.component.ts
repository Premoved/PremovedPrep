import {
	AfterViewInit,
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	OnDestroy,
	computed,
	effect,
	inject,
	input,
	output,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { Chessground } from '@lichess-org/chessground';
import { Api } from '@lichess-org/chessground/api';
import { DrawShape } from '@lichess-org/chessground/draw';
import { Key } from '@lichess-org/chessground/types';
import { CaptchaAnswer, CaptchaChallenge } from '../../core/captcha/captcha.model';
import { afterMove, anyMove, isMateIn, mateIn, playBlack, sanOf } from '../../core/captcha/premove-mate';
import { arrowBrushes } from '../../core/models/preferences.model';
import { PreferencesStore } from '../../core/services/preferences.store';

const MOVE_ANIMATION_MS = 200;

/** How long black 'thinks' before replying. */
const THINKING_MS = 850;

/** Pause before black's answering move when the premove was not mate. */
const REPLY_DELAY_MS = 450;

type Phase = 'waiting' | 'thinking' | 'solved' | 'failed';

@Component({
	selector: 'app-bot-check',
	standalone: true,
	templateUrl: './bot-check.component.html',
	styleUrl: './bot-check.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BotCheckComponent implements AfterViewInit, OnDestroy {
	private readonly prefs = inject(PreferencesStore);
	private readonly host = viewChild<ElementRef<HTMLElement>>('host');

	readonly challenge = input.required<CaptchaChallenge>();

	readonly solved = output<CaptchaAnswer>();

	readonly moveDests = computed(() => this.prefs.moveDests());

	readonly phase = signal<Phase>('waiting');

	readonly hint = signal<string | null>(null);
	readonly hintShown = signal(false);

	private api?: Api;
	private readonly timers: ReturnType<typeof setTimeout>[] = [];

	private interactions = 0;

	private hintMove: string | null = null;

	private drawnId: string | null = null;

	constructor() {
		effect(() => {
			const challenge = this.challenge();
			const coordinates = this.prefs.coordinates();
			const colours = this.prefs.arrowColors();
			this.prefs.pieceSet();
			this.prefs.boardThemeId();

			untracked(() => this.build(challenge, coordinates, colours));
		});
	}

	ngAfterViewInit(): void {
		if (!this.api) {
			this.build(this.challenge(), this.prefs.coordinates(), this.prefs.arrowColors());
		}
	}

	ngOnDestroy(): void {
		this.clearTimers();
		this.api?.destroy();
	}

	tryAgain(): void {
		this.phase.set('waiting');
		this.build(this.challenge(), this.prefs.coordinates(), this.prefs.arrowColors());
	}

	/** Counts a real gesture over the panel. */
	onInteraction(event: Event): void {
		if (event.isTrusted) {
			this.interactions++;
		}
	}

	revealHint(): void {
		if (this.hintMove === null) {
			const challenge = this.challenge();
			const after = playBlack(challenge.fen, challenge.blackMove);
			const solution = after ? mateIn(after.fen) : null;
			this.hintMove = solution;
			this.hint.set(after && solution ? sanOf(after.fen, solution) : null);
		}
		this.hintShown.set(true);
		this.api?.setAutoShapes(this.hintShapes());
	}

	private build(challenge: CaptchaChallenge, coordinates: boolean, colours: readonly string[]): void {
		const element = this.host()?.nativeElement;
		if (!element) {
			return;
		}

		if (this.drawnId !== challenge.id) {
			this.drawnId = challenge.id;
			this.hint.set(null);
			this.hintShown.set(false);
			this.hintMove = null;
			this.phase.set('waiting');
			this.interactions = 0;
		}
		this.clearTimers();

		this.api?.destroy();
		element.innerHTML = '';
		this.api = Chessground(element, this.options(challenge, coordinates, colours));
	}

	private options(challenge: CaptchaChallenge, coordinates: boolean, colours: readonly string[]) {
		return {
			fen: challenge.fen,
			orientation: 'white' as const,
			turnColor: 'black' as const,
			coordinates,
			autoCastle: false,
			/**
			 * 0, not the default 1. Chessground calls preventDefault on touchstart whenever the touch
			 * lands within that radius of any piece, which on a phone is most of the board - and a
			 * cancelled touchstart cancels the scroll with it, no matter what touch-action says. At 0
			 * only a touch on an occupied square is claimed, so a swipe over empty squares scrolls the
			 * page while tapping a piece still selects it.
			 */
			touchIgnoreRadius: 0,
			movable: { free: false, color: 'white' as const, showDests: true, dests: new Map<Key, Key[]>() },
			premovable: {
				enabled: true,
				showDests: true,
				events: { set: (orig: Key, dest: Key) => this.onPremove(orig, dest) },
			},
			draggable: { enabled: true },
			selectable: { enabled: true },
			drawable: {
				// Visible but not editable - `visible` renders the SVG layer the hint arrow needs.
				enabled: false,
				visible: true,
				brushes: arrowBrushes(colours),
				autoShapes: this.hintShapes(),
			},
			animation: { enabled: true, duration: MOVE_ANIMATION_MS },
		};
	}

	private hintShapes(): DrawShape[] {
		if (!this.hintShown() || this.hintMove === null) {
			return [];
		}
		return [{ orig: this.hintMove.slice(0, 2) as Key, dest: this.hintMove.slice(2, 4) as Key, brush: 'green' }];
	}

	/** The player has committed. Black thinks, replies, and the premove answers instantly */
	private onPremove(orig: Key, dest: Key): void {
		if (this.phase() !== 'waiting') {
			return;
		}
		this.phase.set('thinking');

		const challenge = this.challenge();
		const after = playBlack(challenge.fen, challenge.blackMove);
		const api = this.api;
		if (!after || !api) {
			this.phase.set('failed');
			return;
		}

		api.set({ premovable: { enabled: false }, draggable: { enabled: false }, selectable: { enabled: false } });

		this.after(THINKING_MS, () => {
			api.move(challenge.blackMove.slice(0, 2) as Key, challenge.blackMove.slice(2, 4) as Key);

			// requestAnimationFrame gives black's move one frame to start before the premove fires.
			requestAnimationFrame(() => {
				api.set({
					turnColor: 'white',
					movable: { color: 'white', dests: after.dests },
					animation: { enabled: false },
				});
				const played = api.playPremove();
				api.set({ animation: { enabled: true } });

				if (!played) {
					// chessground discarded it: illegal move.
					this.phase.set('failed');
					return;
				}

				const answer = orig + dest;
				if (isMateIn(after.fen, answer)) {
					this.phase.set('solved');
					api.set({ movable: { color: undefined }, premovable: { enabled: false } });
					this.solved.emit({ id: challenge.id, move: answer, interactions: this.interactions });
					return;
				}

				this.answerTheFailedAttempt(api, after.fen, answer);
			});
		});
	}

	/** Black's reply after a failed attempt. */
	private answerTheFailedAttempt(api: Api, beforeWhite: string, whiteMove: string): void {
		const afterWhite = afterMove(beforeWhite, whiteMove);
		const reply = afterWhite ? anyMove(afterWhite) : null;
		if (!reply) {
			this.phase.set('failed');
			return;
		}

		this.after(REPLY_DELAY_MS, () => {
			api.set({ turnColor: 'black' });
			api.move(reply.slice(0, 2) as Key, reply.slice(2, 4) as Key);
			this.after(MOVE_ANIMATION_MS, () => this.phase.set('failed'));
		});
	}

	private after(delay: number, run: () => void): void {
		this.timers.push(setTimeout(run, delay));
	}

	private clearTimers(): void {
		this.timers.forEach((timer) => clearTimeout(timer));
		this.timers.length = 0;
	}
}
