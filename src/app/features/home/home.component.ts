import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	effect,
	ElementRef,
	inject,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ViewportService } from '../../core/layout/viewport.service';
import { BishopLogoComponent } from '../../shared/logo/bishop-logo.component';
import { KnightLogoComponent } from '../../shared/logo/knight-logo.component';
import { RookLogoComponent } from '../../shared/logo/rook-logo.component';
import { PawnLogoComponent } from '../../shared/logo/pawn-logo.component';
import { DesktopAgentLogoComponent } from '../../shared/logo/desktop-agent-logo.component';

interface GuideSection {
	readonly id: string;
	readonly label: string;
}

@Component({
	selector: 'app-home',
	standalone: true,
	imports: [
		RouterLink,
		PawnLogoComponent,
		RookLogoComponent,
		KnightLogoComponent,
		BishopLogoComponent,
		DesktopAgentLogoComponent,
	],
	templateUrl: './home.component.html',
	styleUrl: './home.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
	private readonly destroyRef = inject(DestroyRef);
	readonly viewport = inject(ViewportService);
	private readonly route = inject(ActivatedRoute);

	readonly sections: readonly GuideSection[] = [
		{ id: 'default-tools', label: 'Default tools' },
		{ id: 'analysis-board', label: 'Analysis Board' },
		{ id: 'library', label: 'Library' },
		{ id: 'repertoire', label: 'Repertoire' },
		{ id: 'database-search', label: 'Database Search' },
		{ id: 'account', label: 'Account & Desktop agent' },
	];

	readonly active = signal<string>(this.sections[0].id);
	private readonly bodyEl = viewChild<ElementRef<HTMLElement>>('guideBody');
	private observer: IntersectionObserver | null = null;

	constructor() {
		afterNextRender(() => {
			this.syncScrollSpy();
			this.openRequestedSection();
		});

		effect(() => {
			const mobile = this.viewport.isMobile();
			untracked(() => (mobile ? this.stopScrollSpy() : this.syncScrollSpy()));
		});

		this.destroyRef.onDestroy(() => this.stopScrollSpy());
	}

	private openRequestedSection(): void {
		const id = this.route.snapshot.fragment;
		if (id) {
			this.goTo(id);
		}
	}

	goTo(id: string): void {
		const target = this.sectionElements().find((element) => element.id === id);
		if (!target) {
			return;
		}

		this.active.set(id);
		target.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	private sectionElements(): readonly HTMLElement[] {
		const body = this.bodyEl()?.nativeElement;
		return body ? Array.from(body.querySelectorAll<HTMLElement>('.guide-section')) : [];
	}

	private headingElements(): readonly HTMLElement[] {
		const body = this.bodyEl()?.nativeElement;
		return body ? Array.from(body.querySelectorAll<HTMLElement>('.guide-section > .guide-heading')) : [];
	}

	private recompute(): void {
		const headings = this.headingElements();
		if (headings.length === 0) {
			return;
		}

		const frame = this.frameHeight();
		let topmostVisible: string | null = null;
		let lastPassed: string | null = null;

		for (const heading of headings) {
			const id = heading.parentElement?.id;
			if (!id) {
				continue;
			}
			const rect = heading.getBoundingClientRect();
			if (rect.bottom <= 0) {
				lastPassed = id;
			} else if (rect.top < frame && topmostVisible === null) {
				topmostVisible = id;
			}
		}

		this.active.set(topmostVisible ?? lastPassed ?? this.sections[0].id);
	}

	private frameHeight(): number {
		return typeof window === 'undefined' ? 0 : window.innerHeight;
	}

	private syncScrollSpy(): void {
		if (this.observer || this.viewport.isMobile()) {
			return;
		}

		const headings = this.headingElements();
		if (headings.length === 0 || typeof IntersectionObserver === 'undefined') {
			return;
		}

		this.observer = new IntersectionObserver(() => this.recompute());
		for (const heading of headings) {
			this.observer.observe(heading);
		}

		this.recompute();
	}

	private stopScrollSpy(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
