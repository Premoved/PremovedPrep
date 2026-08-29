export function scrollableAncestor(el: HTMLElement): HTMLElement | null {
	for (let node = el.parentElement; node; node = node.parentElement) {
		const overflowY = getComputedStyle(node).overflowY;
		if (/^(auto|scroll|overlay)$/.test(overflowY) && node.scrollHeight > node.clientHeight + 1) {
			return node;
		}
	}
	return null;
}

/** Scrolls one container only, leaving every other scroll position untouched. */
export function scrollIntoContainer(
	container: HTMLElement,
	target: HTMLElement,
	{ block = 'center', behavior = 'auto' }: { block?: 'center' | 'nearest'; behavior?: ScrollBehavior } = {},
): void {
	const containerBox = container.getBoundingClientRect();
	const targetBox = target.getBoundingClientRect();

	const above = targetBox.top - containerBox.top;
	const below = targetBox.bottom - containerBox.bottom;

	let delta: number;
	if (block === 'center') {
		delta = above - (container.clientHeight - targetBox.height) / 2;
	} else {
		if (above >= 0 && below <= 0) return;
		delta = above < 0 ? above : below;
	}

	const max = container.scrollHeight - container.clientHeight;
	const top = Math.max(0, Math.min(container.scrollTop + delta, max));
	if (Math.abs(top - container.scrollTop) < 1) return;

	container.scrollTo({ top, behavior });
}
