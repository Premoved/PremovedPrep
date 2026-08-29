#!/usr/bin/env node
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Lichess's `sfx` set only. It is AGPLv3+ (Enigmahack); the `standard` set is listed under
 * "Exceptions (non-free)" in lila's COPYING.md and must not be redistributed.
 */
const SET = 'sfx';
const TARGET = join(ROOT, 'public', 'sound', SET);
const SOURCE = `https://raw.githubusercontent.com/lichess-org/lila/master/public/sound/${SET}`;

const SOUNDS = [
	{ key: 'move', file: 'Move' },
	{ key: 'capture', file: 'Capture' },
];

/** Both containers, in preference order. */
const FORMATS = ['mp3', 'ogg'];

/** CI does not need the artwork: the build is verified, not deployed. Set only in the workflow. */
if (process.env.PREMOVEDPREP_SKIP_ASSETS === '1') {
	console.log('fetch-lichess-sounds: PREMOVEDPREP_SKIP_ASSETS=1, nothing fetched.');
	process.exit(0);
}

async function present() {
	try {
		return new Set(await readdir(TARGET));
	} catch {
		return new Set();
	}
}

async function fetchOne(sound, format, onDisk) {
	const name = `${sound.file}.${format}`;
	if (onDisk.has(name)) {
		return { name, status: 'present' };
	}

	const response = await fetch(`${SOURCE}/${name}`);
	if (!response.ok) {
		return { name, status: 'missing', detail: `${response.status}` };
	}

	await writeFile(join(TARGET, name), Buffer.from(await response.arrayBuffer()));
	return { name, status: 'downloaded' };
}

/** Only files actually on disk. The manifest never claims a recording the browser cannot fetch. */
async function readInstalled() {
	const onDisk = await present();
	const sounds = {};

	for (const sound of SOUNDS) {
		const formats = FORMATS.filter((format) => onDisk.has(`${sound.file}.${format}`));
		if (formats.length > 0) {
			sounds[sound.key] = formats.map((format) => `${SET}/${sound.file}.${format}`);
		}
	}
	return sounds;
}

async function main() {
	await mkdir(TARGET, { recursive: true });
	const onDisk = await present();

	for (const sound of SOUNDS) {
		for (const format of FORMATS) {
			let result;
			try {
				result = await fetchOne(sound, format, onDisk);
			} catch (error) {
				// One unreachable file must not stop the rest, or the build.
				result = {
					name: `${sound.file}.${format}`,
					status: 'failed',
					detail: error instanceof Error ? error.message : String(error),
				};
			}
			const suffix = result.detail ? ` (${result.detail})` : '';
			console.log(`${result.status.padEnd(10)} ${result.name}${suffix}`);
		}
	}

	const sounds = await readInstalled();
	const manifest = { source: SOURCE, sounds };
	await writeFile(join(ROOT, 'public', 'sound', 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`, 'utf8');

	const names = Object.keys(sounds);
	console.log(`\n${names.length} sound(s) installed${names.length > 0 ? `: ${names.join(', ')}` : ''}.`);
	if (names.length < SOUNDS.length) {
		console.warn('Some sounds are missing. The board stays silent rather than failing; MoveSoundService reads');
		console.warn('this manifest and switches itself off when a sound is not listed.');
	}
	console.log('Sounds by Enigmahack, AGPLv3+, from lichess-org/lila. Attribution is in THIRD-PARTY.md.');
}

// The manifest is always written, so a failure here means silence rather than a failed build.
await main().catch((error) => {
	console.error(`fetch-lichess-sounds: ${error instanceof Error ? error.message : error}`);
});
