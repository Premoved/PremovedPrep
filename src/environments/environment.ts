export const environment = {
	production: false,
	// Uses the page's hostname, not localhost, so the dev server is reachable over LAN from mobile.
	apiBaseUrl: `${location.protocol}//${location.hostname}:8080/api`,
	sourceCodeUrl: 'https://github.com/Premoved/PremovedPrep',
	contactEmail: 'contact@premoved.com',
	desktopApp: {
		repoUrl: 'https://github.com/Premoved/PremovedPrep-App',
		releasesUrl: 'https://github.com/Premoved/PremovedPrep-App/releases',
		// One entry per build a release publishes; `file` must match the release asset's name exactly.
		builds: [
			{ platform: 'Windows', detail: '64-bit installer', file: 'PremovedPrep-Setup.exe' },
			{ platform: 'Windows portable', detail: 'no installer, runs as it is', file: 'PremovedPrep-Portable.exe' },
		],
	},
};
