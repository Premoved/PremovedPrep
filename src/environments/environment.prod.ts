export const environment = {
	production: true,
	apiBaseUrl: 'https://api.premovedprep.com/api',
	sourceCodeUrl: 'https://github.com/Premoved/PremovedPrep',
	contactEmail: 'contact@premoved.com',
	desktopApp: {
		repoUrl: 'https://github.com/Premoved/PremovedPrep-App',
		releasesUrl: 'https://github.com/Premoved/PremovedPrep-App/releases',
		// Only what the release actually carries: a link to a missing asset answers 404.
		builds: [
			{ platform: 'Windows', detail: '64-bit installer', file: 'PremovedPrep-Setup.exe' },
			{ platform: 'Windows portable', detail: 'no installer, runs as it is', file: 'PremovedPrep-Portable.exe' },
		],
	},
};
