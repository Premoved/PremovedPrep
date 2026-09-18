/**
 * A zip file, built in the browser, with no compression and no dependency.
 *
 * WHY THIS EXISTS
 *
 * "Export the whole shelf" used to be a GET that the server answered with a zip it had built out of
 * the stored PGNs. It cannot read them any more, so the file is assembled here, out of entries this
 * browser has just decrypted, and handed straight to the person - which also means an export never
 * crosses the network at all.
 *
 * WHY STORED AND NOT DEFLATED
 *
 * A zip entry may be stored verbatim; every unzipper in existence reads that, and it is about eighty
 * lines instead of a compression library. The obvious objection is size, and the answer is that
 * these files are small: an account holds at most 2 MB of entries, and what is being packaged is
 * already the contents of that budget. Deflating them would save a person perhaps a megabyte on a
 * download they asked for by name, at the cost of a dependency in the critical path of an export.
 *
 * If that trade ever stops looking right, CompressionStream('deflate-raw') produces exactly what
 * method 8 wants, and the only changes here are the method field and the two lengths.
 */

export interface ZipEntry {
	readonly name: string;
	readonly text: string;
}

const STORED = 0;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/** Zip's own epoch is 1980, and it stores the time in the DOS packed form. */
function dosTime(at: Date): { time: number; date: number } {
	return {
		time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
		date: ((Math.max(1980, at.getFullYear()) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
	};
}

export function buildZip(entries: readonly ZipEntry[], at: Date = new Date()): Blob {
	const encoder = new TextEncoder();
	const { time, date } = dosTime(at);

	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const body = encoder.encode(entry.text);
		const crc = crc32(body);

		const local = new Uint8Array(30 + name.length);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, LOCAL_HEADER, true);
		localView.setUint16(4, 20, true); // version needed
		/**
		 * Bit 11: the name is UTF-8. Without it an unzipper falls back to code page 437 and a folder
		 * called "Grünfeld" arrives mangled.
		 */
		localView.setUint16(6, 0x0800, true);
		localView.setUint16(8, STORED, true);
		localView.setUint16(10, time, true);
		localView.setUint16(12, date, true);
		localView.setUint32(14, crc, true);
		localView.setUint32(18, body.length, true);
		localView.setUint32(22, body.length, true);
		localView.setUint16(26, name.length, true);
		localView.setUint16(28, 0, true); // extra field length
		local.set(name, 30);

		const central = new Uint8Array(46 + name.length);
		const centralView = new DataView(central.buffer);
		centralView.setUint32(0, CENTRAL_HEADER, true);
		centralView.setUint16(4, 20, true); // version made by
		centralView.setUint16(6, 20, true); // version needed
		centralView.setUint16(8, 0x0800, true);
		centralView.setUint16(10, STORED, true);
		centralView.setUint16(12, time, true);
		centralView.setUint16(14, date, true);
		centralView.setUint32(16, crc, true);
		centralView.setUint32(20, body.length, true);
		centralView.setUint32(24, body.length, true);
		centralView.setUint16(28, name.length, true);
		centralView.setUint32(42, offset, true);
		central.set(name, 46);

		locals.push(local, body);
		centrals.push(central);
		offset += local.length + body.length;
	}

	const centralSize = centrals.reduce((total, part) => total + part.length, 0);

	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, END_OF_CENTRAL, true);
	endView.setUint16(8, entries.length, true);
	endView.setUint16(10, entries.length, true);
	endView.setUint32(12, centralSize, true);
	endView.setUint32(16, offset, true);

	return new Blob([...locals, ...centrals, end] as BlobPart[], { type: 'application/zip' });
}

/** The table is built once, on first use: 256 entries, and nothing needs it until an export. */
let table: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
	if (table === null) {
		table = new Uint32Array(256);
		for (let i = 0; i < 256; i++) {
			let value = i;
			for (let bit = 0; bit < 8; bit++) {
				value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
			}
			table[i] = value >>> 0;
		}
	}

	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
