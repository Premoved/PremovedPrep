/**
 * A ResizeObserver whose callback runs on the next animation frame, and at most once per frame.
 *
 * `ResizeObserver loop completed with undelivered notifications` is what the browser reports when
 * a resize callback changes layout, which schedules another observation pass before the current
 * one has finished being delivered. Nothing visibly breaks - the browser drops the extra
 * notification and re-runs on the next frame - but it fired tens of times per page on the analysis
 * board, and every round is a real layout recalculation. On a phone that is battery spent for
 * nothing.
 *
 * Deferring the work takes the write out of the observation cycle: the observer only observes, and
 * the layout change it causes lands in a frame of its own. Coalescing to one call per frame also
 * collapses the burst of notifications a single drag produces.
 *
 * The pending frame is cancelled on disconnect, so a callback can never run against a view that
 * has already been destroyed.
 */
export class FrameResizeObserver {
	private readonly observer: ResizeObserver;
	private frame = 0;

	constructor(callback: () => void) {
		this.observer = new ResizeObserver(() => {
			if (this.frame !== 0) return;
			this.frame = requestAnimationFrame(() => {
				this.frame = 0;
				callback();
			});
		});
	}

	observe(target: Element): void {
		this.observer.observe(target);
	}

	disconnect(): void {
		if (this.frame !== 0) {
			cancelAnimationFrame(this.frame);
			this.frame = 0;
		}
		this.observer.disconnect();
	}
}
