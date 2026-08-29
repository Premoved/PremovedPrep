export type EngineKind = 'wasm' | 'local';

export interface EngineDefinition {
	readonly id: string;
	readonly kind: EngineKind;
	readonly label: string;
	readonly shortLabel: string;
	readonly worker: string | null;
	readonly threads: boolean;
	/**
	 * True for pthreads builds: they allocate a SharedArrayBuffer, so the page must be cross-origin isolated.
	 */
	readonly requiresIsolation: boolean;
	readonly maxHashMb: number;
	readonly downloadMb: number;
}

const BIN = 'engine';

const WASM_HEAP_CEILING_MB = 2048;

export const ENGINE_CATALOGUE: readonly EngineDefinition[] = [
	{
		id: 'sf18',
		kind: 'wasm',
		label: 'Stockfish 18 · 113MB NNUE · multi-threaded',
		shortLabel: 'SF 18 · 113MB NNUE',
		worker: `${BIN}/stockfish-18.js`,
		threads: true,
		requiresIsolation: true,
		/** A quarter of the heap: the full network is 113 MB on disk and more once resident. */
		maxHashMb: WASM_HEAP_CEILING_MB / 4,
		downloadMb: 113,
	},
	{
		id: 'sf18-single',
		kind: 'wasm',
		label: 'Stockfish 18 · 113MB NNUE · single-threaded',
		shortLabel: 'SF 18 · 113MB NNUE',
		worker: `${BIN}/stockfish-18-single.js`,
		threads: false,
		requiresIsolation: false,
		maxHashMb: WASM_HEAP_CEILING_MB / 4,
		downloadMb: 113,
	},
	{
		id: 'sf18-lite',
		kind: 'wasm',
		label: 'Stockfish 18 Lite · 7MB NNUE · multi-threaded',
		shortLabel: 'SF 18 Lite · 7MB NNUE',
		worker: `${BIN}/stockfish-18-lite.js`,
		threads: true,
		requiresIsolation: true,
		maxHashMb: WASM_HEAP_CEILING_MB / 2,
		downloadMb: 7,
	},
	{
		id: 'sf18-lite-single',
		kind: 'wasm',
		label: 'Stockfish 18 Lite · 7MB NNUE · single-threaded',
		shortLabel: 'SF 18 Lite · 7MB NNUE',
		worker: `${BIN}/stockfish-18-lite-single.js`,
		threads: false,
		requiresIsolation: false,
		maxHashMb: WASM_HEAP_CEILING_MB / 2,
		downloadMb: 7,
	},
	{
		id: 'sf18-asm',
		kind: 'wasm',
		label: 'Stockfish 18 · asm.js · no WebAssembly required',
		shortLabel: 'SF 18 asm.js',
		worker: `${BIN}/stockfish-18-asm.js`,
		threads: false,
		requiresIsolation: false,
		maxHashMb: 256,
		downloadMb: 11,
	},
	{
		id: 'local',
		kind: 'local',
		label: 'Local engine · via Desktop Agent',
		shortLabel: 'Local engine',
		worker: null,
		threads: true,
		requiresIsolation: false,
		maxHashMb: 16384,
		downloadMb: 0,
	},
];

export const DEFAULT_ENGINE_ID = 'sf18-lite-single';

/** Falls back to the default instead of throwing, because the id can come from stored preferences. */
export function engineById(id: string): EngineDefinition {
	const found = ENGINE_CATALOGUE.find((engine) => engine.id === id);
	if (found) return found;
	return ENGINE_CATALOGUE.find((engine) => engine.id === DEFAULT_ENGINE_ID) ?? ENGINE_CATALOGUE[0];
}
