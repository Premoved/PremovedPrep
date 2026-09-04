import { Injectable } from '@angular/core';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;
const TEXT_ENTRY = 'input, textarea, select, [contenteditable]';
/** Window after our synthetic contextmenu in which a native one is a duplicate of it. */
const NATIVE_WINDOW_MS = 1500;

/** Turns a touch long press into a contextmenu event, unless the browser produced one itself. */
@Injectable({ providedIn: 'root' })
export class LongPressService {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private startX = 0;
	private startY = 0;
	private target: HTMLElement | null = null;
	private firedAt = 0;

	private dispatching = false;
	private swallowClick = false;

	constructor() {
		document.addEventListener('pointerdown', this.onPointerDown, { capture: true, passive: true });
		document.addEventListener('pointermove', this.onPointerMove, { capture: true, passive: true });
		document.addEventListener('pointerup', this.cancel, { capture: true, passive: true });
		document.addEventListener('pointercancel', this.cancel, { capture: true, passive: true });
		document.addEventListener('scroll', this.cancel, { capture: true, passive: true });
		document.addEventListener('contextmenu', this.onContextMenu, { capture: true });
		document.addEventListener('click', this.onClick, { capture: true });
	}

	private readonly onPointerDown = (event: PointerEvent): void => {
		this.cancel();
		this.swallowClick = false;
		if (event.pointerType === 'mouse') return;

		const target = event.target as HTMLElement | null;
		if (!target || target.closest(TEXT_ENTRY)) return;

		this.target = target;
		this.startX = event.clientX;
		this.startY = event.clientY;
		this.timer = setTimeout(() => this.fire(), LONG_PRESS_MS);
	};

	private readonly onPointerMove = (event: PointerEvent): void => {
		if (this.timer === null) return;
		if (Math.abs(event.clientX - this.startX) > MOVE_TOLERANCE_PX) this.cancel();
		else if (Math.abs(event.clientY - this.startY) > MOVE_TOLERANCE_PX) this.cancel();
	};

	private readonly cancel = (): void => {
		if (this.timer === null) return;
		clearTimeout(this.timer);
		this.timer = null;
		this.target = null;
	};

	private fire(): void {
		this.timer = null;
		const target = (document.elementFromPoint(this.startX, this.startY) as HTMLElement | null) ?? this.target;
		this.target = null;
		if (!target) return;

		this.swallowClick = true;
		this.dispatching = true;
		target.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				view: window,
				clientX: this.startX,
				clientY: this.startY,
				button: 2,
				buttons: 2,
			}),
		);
		this.dispatching = false;
		this.firedAt = Date.now();

		navigator.vibrate?.(10);
	}

	private readonly onContextMenu = (event: MouseEvent): void => {
		if (this.dispatching) return;
		if (!event.isTrusted) return;

		/**
		 * The browser produced one itself for this press, so there is nothing left to synthesise.
		 *
		 * This used to latch a `browserHasItsOwn` flag and stop synthesising for the rest of the
		 * session. One native contextmenu anywhere - long-pressing the board to draw an arrow is
		 * enough - then killed long-press everywhere else, which is why holding a utility button
		 * showed no tooltip. Whether a browser has its own long press is not a fact worth inferring
		 * once and keeping.
		 */
		this.cancel();

		/** Ours went out a moment ago: a second one would open the same menu twice. */
		if (Date.now() - this.firedAt < NATIVE_WINDOW_MS) {
			event.preventDefault();
			event.stopPropagation();
		}
	};

	private readonly onClick = (event: MouseEvent): void => {
		if (!this.swallowClick) return;
		this.swallowClick = false;
		event.preventDefault();
		event.stopPropagation();
	};
}
