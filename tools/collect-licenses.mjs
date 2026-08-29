#!/usr/bin/env node
import { access, copyFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Puts the dependency licence notices inside the deployed folder.
 *
 * Angular writes 3rdpartylicenses.txt beside `browser/`, not in it, so nothing that reaches
 * Cloudflare Pages carries the notices for the GPL code this application bundles. Chessground and
 * Stockfish are GPL-3.0-or-later; conveying them means conveying their terms with them.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

async function outputDir() {
	const projects = await readdir(DIST, { withFileTypes: true });
	for (const project of projects) {
		if (!project.isDirectory()) continue;
		const browser = join(DIST, project.name, 'browser');
		try {
			await access(browser);
			return { project: join(DIST, project.name), browser };
		} catch {
			// Not an application build output; keep looking.
		}
	}
	return null;
}

async function main() {
	const out = await outputDir();
	if (!out) {
		console.warn('collect-licenses: no dist/<project>/browser found; run a build first.');
		return;
	}

	const notices = join(out.project, '3rdpartylicenses.txt');
	try {
		await access(notices);
	} catch {
		console.warn('collect-licenses: 3rdpartylicenses.txt was not generated; nothing copied.');
		return;
	}

	const target = join(out.browser, 'licenses');
	await mkdir(target, { recursive: true });
	await copyFile(notices, join(target, '3rdpartylicenses.txt'));
	console.log('collect-licenses: licenses/3rdpartylicenses.txt written into the deployed folder.');

	// THIRD-PARTY.md is the attribution the CC BY piece sets and Boxicons require, so it has to be
	// reachable from the site and not only from the repository.
	for (const name of ['THIRD-PARTY.md', 'LICENSE']) {
		try {
			await copyFile(join(ROOT, name), join(target, name));
			console.log(`collect-licenses: licenses/${name} written into the deployed folder.`);
		} catch {
			console.warn(`collect-licenses: ${name} not found in the repository root; not deployed.`);
		}
	}
}

await main().catch((error) => {
	console.error(`collect-licenses: ${error instanceof Error ? error.message : error}`);
});
