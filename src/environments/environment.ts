export const environment = {
	production: false,
	/** Allows LAN access from mobile */
	apiBaseUrl: `${location.protocol}//${location.hostname}:8080/api`,
	sourceCodeUrl: 'https://github.com/Premoved/PremovedPrep',
	contactEmail: 'contact@premoved.com',
	desktopApp: {
		repoUrl: 'https://github.com/Premoved/PremovedPrep-App',
		releasesUrl: 'https://github.com/Premoved/PremovedPrep-App/releases',
		/** One entry per build a release publishes. `file` is the asset's name, exactly. */
		builds: [
			{ platform: 'Windows', detail: '64-bit installer', file: 'PremovedPrep-Setup.exe' },
			{ platform: 'macOS', detail: 'Apple silicon and Intel', file: 'PremovedPrep.dmg' },
			{ platform: 'Linux', detail: 'AppImage, x86-64', file: 'PremovedPrep.AppImage' },
		],
	},
};
