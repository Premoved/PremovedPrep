import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideAppInitializer, inject } from '@angular/core';
import { PreloadAllModules, provideRouter, withComponentInputBinding, withPreloading } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { AuthService } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';
import { PreferencesStore } from './core/services/preferences.store';
import { AgentBridgeService } from './core/agent/agent-bridge.service';
import { MoveSoundService } from './core/sound/move-sound.service';
import { AnalyticsService } from './core/analytics/analytics.service';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideRouter(routes, withComponentInputBinding(), withPreloading(PreloadAllModules)),
		/**
		 * errorInterceptor first, so it is the outer one: authInterceptor then sees a raw 401 rather
		 * than the ApiError the UI is meant to read, and a 401 it recovers from by refreshing never
		 * becomes a message at all.
		 */
		provideHttpClient(withInterceptors([errorInterceptor, authInterceptor])),

		provideAppInitializer(() => {
			inject(ThemeService).init();
			// Loads user preferences early to prevent the board from initially rendering with default settings
			const prefs = inject(PreferencesStore);
			prefs.init();
			// Loads the sound manifest in the background without blocking application startup
			const sounds = inject(MoveSoundService);
			void sounds.load();
			sounds.primeOnFirstGesture(() => prefs.sound());
			// Instantiated eagerly so the Desktop Agent starts searching on init
			inject(AgentBridgeService);
			// Initializes analytics: does nothing if no configuration key is provided.
			inject(AnalyticsService).init();
			return inject(AuthService).restoreSession();
		}),
	],
};
