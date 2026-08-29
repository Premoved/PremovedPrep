import { Component, DestroyRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { ViewportService } from '../../core/layout/viewport.service';
import { LogoComponent } from '../../shared/logo/logo.component';
import { KnightLogoComponent } from '../../shared/logo/knight-logo.component';
import { RookLogoComponent } from '../../shared/logo/rook-logo.component';
import { BishopLogoComponent } from '../../shared/logo/bishop-logo.component';
import { PawnLogoComponent } from '../../shared/logo/pawn-logo.component';
import { DesktopAgentLogoComponent } from '../../shared/logo/desktop-agent-logo.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { environment } from '../../../environments/environment';
import { fitOnScreen } from '../../core/browser/menu-placement';

interface RailTooltip {
	readonly text: string;
	readonly x: number;
	readonly y: number;
}

interface NavContextMenu {
	readonly path: string;
	readonly x: number;
	readonly y: number;
}

/** Context menu size, used for screen boundary detection */
const NAV_MENU_FOOTPRINT = { width: 176, height: 44 };

@Component({
	selector: 'app-main-layout',
	standalone: true,
	imports: [
		NgTemplateOutlet,
		RouterLink,
		RouterLinkActive,
		RouterOutlet,
		LogoComponent,
		KnightLogoComponent,
		RookLogoComponent,
		BishopLogoComponent,
		PawnLogoComponent,
		DesktopAgentLogoComponent,
		ConfirmDialogComponent,
	],
	templateUrl: './main-layout.component.html',
	styleUrl: './main-layout.component.css',
})
export class MainLayoutComponent {
	readonly auth = inject(AuthService);
	readonly theme = inject(ThemeService);
	readonly viewport = inject(ViewportService);
	private readonly router = inject(Router);
	readonly collapsed = signal(false);

	readonly sourceCodeUrl = environment.sourceCodeUrl;

	readonly contactEmail = environment.contactEmail;

	readonly railTooltip = signal<RailTooltip | null>(null);

	showRailTooltip(event: Event): void {
		if (!this.collapsed()) return;
		this.showTooltipFor(event);
	}

	showAccountTooltip(event: Event): void {
		this.showTooltipFor(event);
	}

	/** Falls back to '.nav-label' content if no 'data-tooltip' is found */
	private showTooltipFor(event: Event): void {
		const el = event.currentTarget as HTMLElement;
		const text = el.dataset['tooltip']?.trim() || el.querySelector('.nav-label')?.textContent?.trim();
		if (!text) return;

		const rect = el.getBoundingClientRect();
		this.railTooltip.set({ text, x: rect.right + 10, y: rect.top + rect.height / 2 });
	}

	hideRailTooltip(): void {
		this.railTooltip.set(null);
	}
	readonly toggleOffset = signal<number | null>(null);
	readonly dragging = signal(false);
	private dragStartY = 0;
	private dragMoved = false;

	toggleSidebar(): void {
		this.collapsed.update((v) => !v);
	}

	startDrag(event: PointerEvent): void {
		event.preventDefault();
		this.dragging.set(true);
		this.dragMoved = false;
		this.dragStartY = event.clientY;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	onDrag(event: PointerEvent, sidebarEl: HTMLElement): void {
		if (!this.dragging()) {
			return;
		}
		if (Math.abs(event.clientY - this.dragStartY) > 3) {
			this.dragMoved = true;
		}
		const rect = sidebarEl.getBoundingClientRect();
		const min = 16;
		const max = rect.height - 32;
		const y = Math.min(Math.max(event.clientY - rect.top, min), max);
		this.toggleOffset.set(y);
	}

	stopDrag(): void {
		if (!this.dragging()) {
			return;
		}
		this.dragging.set(false);
		if (!this.dragMoved) {
			this.toggleSidebar();
		}
	}

	logout(): void {
		this.auth.logout();
	}

	private readonly drawerOpen = signal(false);

	readonly drawerVisible = computed(() => this.viewport.isMobile() && this.drawerOpen());

	constructor() {
		const navigation = this.router.events.subscribe((event) => {
			if (event instanceof NavigationEnd) this.drawerOpen.set(false);
		});
		inject(DestroyRef).onDestroy(() => navigation.unsubscribe());

		effect(() => {
			document.body.style.overflow = this.drawerVisible() ? 'hidden' : '';
		});
	}

	toggleDrawer(): void {
		this.drawerOpen.update((open) => !open);
	}

	closeDrawer(): void {
		this.drawerOpen.set(false);
	}

	@HostListener('document:keydown.escape')
	onEscape(): void {
		this.closeDrawer();
	}

	readonly navContextMenu = signal<NavContextMenu | null>(null);

	onNavContextMenu(event: MouseEvent, path: string): void {
		// Prevents the global document click handler from immediately closing the opened menu
		event.preventDefault();
		event.stopPropagation();
		const at = fitOnScreen(event.clientX, event.clientY, NAV_MENU_FOOTPRINT);
		this.navContextMenu.set({ path, x: at.x, y: at.y });
	}

	openNavInNewTab(): void {
		const menu = this.navContextMenu();
		this.closeNavContextMenu();
		if (menu) {
			window.open(menu.path, '_blank', 'noopener');
		}
	}

	@HostListener('document:click')
	@HostListener('document:contextmenu')
	@HostListener('window:blur')
	closeNavContextMenu(): void {
		this.navContextMenu.set(null);
	}
}
