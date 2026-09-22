import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideAppInitializer, inject } from '@angular/core';
import { PreloadAllModules, provideRouter, withComponentInputBinding, withPreloading } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { AuthService } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';
import { PreferencesStore } from './core/services/preferences.store';
import { MoveSoundService } from './core/sound/move-sound.service';
import { AnalyticsService } from './core/analytics/analytics.service';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideRouter(routes, withComponentInputBinding(), withPreloading(PreloadAllModules)),
		// errorInterceptor must be outer: otherwise authInterceptor's refreshed 401 never reaches it as an ApiError.
		provideHttpClient(withInterceptors([errorInterceptor, authInterceptor])),

		provideAppInitializer(() => {
			inject(ThemeService).init();
			const prefs = inject(PreferencesStore);
			prefs.init();
			const sounds = inject(MoveSoundService);
			void sounds.load();
			sounds.primeOnFirstGesture(() => prefs.sound());
			inject(AnalyticsService).init();
			return inject(AuthService).restoreSession();
		}),
	],
};
