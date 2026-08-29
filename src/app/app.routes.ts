import { Routes } from '@angular/router';
import { HomeComponent } from './features/home/home.component';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';
import { MainLayoutComponent } from './layout/main-layout/main-layout.component';

/** Route data (`kind` and `color`) is sent automatically into component inputs */

/**
 * Only the shell and Home are in the initial bundle. Every other page is a `loadComponent`, so
 * chessground, chess.js and the board itself are fetched on the first navigation to a page that
 * needs them. PreloadAllModules in app.config.ts pulls those chunks in the background once the
 * application has started, so a navigation still resolves without a visible wait.
 */
export const routes: Routes = [
	{
		path: 'login',
		loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
	},
	{
		path: 'register',
		loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
	},

	// Standalone pages opened from email links
	{
		path: 'forgot-password',
		loadComponent: () => import('./features/auth/forgot-password.component').then((m) => m.ForgotPasswordComponent),
	},
	{
		path: 'reset-password',
		loadComponent: () => import('./features/auth/reset-password.component').then((m) => m.ResetPasswordComponent),
	},
	{
		path: 'verify-email',
		loadComponent: () => import('./features/auth/verify-email.component').then((m) => m.VerifyEmailComponent),
	},
	{
		path: '',
		component: MainLayoutComponent,
		children: [
			{ path: '', pathMatch: 'full', redirectTo: 'home' },
			{ path: 'home', component: HomeComponent },
			{ path: 'menu', pathMatch: 'full', redirectTo: 'home' },
			{
				path: 'analysis',
				loadComponent: () =>
					import('./features/analysis-board/analysis-board.component').then((m) => m.AnalysisBoardComponent),
				canDeactivate: [unsavedChangesGuard],
			},
			{
				path: 'library',
				children: [
					{
						path: '',
						loadComponent: () =>
							import('./features/collections/collections-page.component').then((m) => m.CollectionsPageComponent),
						data: {
							kind: 'LIBRARY',
							title: 'Library',
							description: 'A place for keeping ideas and studies organized.',
						},
					},
					{
						path: 'c/:id',
						loadComponent: () =>
							import('./features/collections/collection-view.component').then((m) => m.CollectionViewComponent),
						data: { kind: 'LIBRARY' },
					},
					// View a local file/collection linked via the desktop agent.
					{
						path: 'local/:id',
						loadComponent: () =>
							import('./features/collections/local-collection-view.component').then(
								(m) => m.LocalCollectionViewComponent,
							),
						data: { kind: 'LIBRARY' },
					},
				],
			},
			{
				path: 'repertoire',
				children: [
					{
						path: '',
						loadComponent: () =>
							import('./features/collections/collections-page.component').then((m) => m.CollectionsPageComponent),
						data: {
							kind: 'REPERTOIRE',
							title: 'Repertoire',
							description: 'A place for keeping opening ideas and preparation.',
						},
					},
					{
						path: 'c/:id',
						loadComponent: () =>
							import('./features/collections/collection-view.component').then((m) => m.CollectionViewComponent),
						data: { kind: 'REPERTOIRE' },
					},
					{
						path: 'local/:id',
						loadComponent: () =>
							import('./features/collections/local-collection-view.component').then(
								(m) => m.LocalCollectionViewComponent,
							),
						data: { kind: 'REPERTOIRE' },
					},
				],
			},
			{
				path: 'search',
				loadComponent: () => import('./features/search/search-page.component').then((m) => m.SearchPageComponent),
			},
			{
				path: 'agent',
				loadComponent: () => import('./features/agent/agent-page.component').then((m) => m.AgentPageComponent),
			},
			{
				path: 'settings',
				loadComponent: () => import('./features/settings/settings-page.component').then((m) => m.SettingsPageComponent),
			},
		],
	},
	{ path: '**', redirectTo: 'home' },
];
