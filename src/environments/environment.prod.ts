export const environment = {
	production: true,
	apiBaseUrl: 'https://api.premovedprep.com/api',
	sourceCodeUrl: 'https://github.com/Premoved/PremovedPrep',
	contactEmail: 'contact@premoved.com',
	desktopApp: {
		repoUrl: 'https://github.com/Premoved/PremovedPrep-App',
		releasesUrl: 'https://github.com/Premoved/PremovedPrep-App/releases',
		// Only what a release actually carries; each name is the stable asset the build produces.
		builds: [
			{ platform: 'Windows', detail: '64-bit installer', file: 'PremovedPrep-Setup.exe' },
			{ platform: 'Windows portable', detail: 'no installer, runs as it is', file: 'PremovedPrep-Portable.exe' },
			{ platform: 'macOS', detail: 'Apple silicon and Intel', file: 'PremovedPrep.dmg' },
			{ platform: 'Linux', detail: 'AppImage, x86-64', file: 'PremovedPrep.AppImage' },
		],
	},
};
