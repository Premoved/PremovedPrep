import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DrawShape } from '@lichess-org/chessground/draw';
import { Key } from '@lichess-org/chessground/types';
import {
	DeviceCapabilities,
	SEARCH_TIME_STEPS,
	maxThreads,
	readDeviceCapabilities,
	recommendedHashMb,
	recommendedThreads,
	unsupportedReason,
} from '../../../core/engine/engine-capabilities';
import { DEFAULT_ENGINE_ID, EngineDefinition, engineById } from '../../../core/engine/engine-catalogue';
import { EngineTransport, createWasmEngine } from '../../../core/engine/engine-transport';
import { EngineLine, parseInfoLine, parseUciMove } from '../../../core/engine/uci';
import { UciSession } from '../../../core/engine/uci-session';
import { GamePreviewStore } from './game-preview.store';
import { MoveTreeStore } from './move-tree.store';

export interface EngineSettings {
	readonly searchSeconds: number;
	readonly multiPv: number;
	readonly threads: number;
	readonly hashMb: number;
}

export type EngineStatus = 'off' | 'loading' | 'ready' | 'searching' | 'failed';

const ARROW_WIDTHS = [13, 10, 8, 6, 5];

@Injectable()
export class EngineStore {
	private readonly tree = inject(MoveTreeStore);
	private readonly preview = inject(GamePreviewStore);

	private readonly boardTree = computed(() => this.preview.tree() ?? this.tree);

	readonly positionFen = computed(() => this.boardTree().currentNode().fen);

	private readonly solutionHidden = computed(() => this.boardTree().solutionHiddenAtCurrent());

	readonly capabilities: DeviceCapabilities = readDeviceCapabilities();

	private readonly _enabled = signal(false);
	private readonly _definition = signal<EngineDefinition>(engineById(DEFAULT_ENGINE_ID));
	private readonly _status = signal<EngineStatus>('off');
	private readonly _error = signal<string | null>(null);
	private readonly _lines = signal<readonly EngineLine[]>([]);
	private readonly _depth = signal(0);
	private readonly _nps = signal(0);

	private readonly _hoveredLine = signal<number | null>(null);

	private readonly _arrowsVisible = signal(false);

	private readonly _settings = signal<EngineSettings>(this.defaultSettings(engineById(DEFAULT_ENGINE_ID)));

	readonly enabled = this._enabled.asReadonly();
	readonly definition = this._definition.asReadonly();
	readonly status = this._status.asReadonly();
	readonly error = this._error.asReadonly();
	readonly settings = this._settings.asReadonly();
	readonly depth = this._depth.asReadonly();
	readonly nps = this._nps.asReadonly();

	readonly lines = computed(() => [...this._lines()].sort((a, b) => a.multipv - b.multipv));

	readonly best = computed<EngineLine | null>(() => this.lines()[0] ?? null);

	readonly arrowsVisible = this._arrowsVisible.asReadonly();

	readonly boardShapes = computed<DrawShape[]>(() => {
		const hovered = this._hoveredLine();
		const lines = this.lines();

		if (!this._arrowsVisible()) {
			const one = lines.find((line) => line.multipv === hovered);
			return one ? [arrowFor(one, 0)] : [];
		}

		return lines.map((line, rank) => arrowFor(line, line.multipv === hovered ? 0 : rank));
	});

	readonly maxThreads = computed(() => maxThreads(this.capabilities, this._definition()));

	readonly recommendedThreads = computed(() => recommendedThreads(this.capabilities, this._definition()));

	readonly recommendedHashMb = computed(() => recommendedHashMb(this.capabilities, this._definition()));

	readonly unsupported = computed(() => unsupportedReason(this._definition(), this.capabilities));

	readonly displayName = computed(() => this._definition().shortLabel);

	private transport: EngineTransport | null = null;
	private loadedKey = '';

	private session: UciSession | null = null;

	constructor() {
		effect(() => {
			const enabled = this._enabled();
			const definition = this._definition();
			const settings = this._settings();
			const fen = this.positionFen();

			if (!enabled) {
				this.shutDown();
				return;
			}
			this.start(definition, settings, fen);
		});
	}

	setEnabled(enabled: boolean): void {
		// The hidden solution must never reach the engine, whichever caller asks to enable it.
		if (enabled && this.solutionHidden()) return;
		this._enabled.set(enabled);
	}

	selectEngine(id: string): void {
		const definition = engineById(id);
		if (definition.id === this._definition().id) return;
		this._definition.set(definition);
		this._settings.set(this.defaultSettings(definition));
	}

	setHoveredLine(multipv: number | null): void {
		this._hoveredLine.set(multipv);
	}

	toggleArrows(): void {
		this._arrowsVisible.update((on) => !on);
	}

	updateSettings(patch: Partial<EngineSettings>): void {
		this._settings.update((current) => ({ ...current, ...patch }));
	}

	private defaultSettings(definition: EngineDefinition): EngineSettings {
		return {
			searchSeconds: Infinity,
			multiPv: 2,
			threads: recommendedThreads(this.capabilities, definition),
			hashMb: recommendedHashMb(this.capabilities, definition),
		};
	}

	private start(definition: EngineDefinition, settings: EngineSettings, fen: string): void {
		const reason = unsupportedReason(definition, this.capabilities);
		if (reason) {
			this.shutDown();
			this._status.set('failed');
			this._error.set(reason);
			return;
		}

		if (this.transport && this.loadedKey === this.keyFor(definition, settings)) {
			this.search(fen);
			return;
		}

		this.shutDown();

		this._status.set('loading');
		this._error.set(null);
		this.loadedKey = this.keyFor(definition, settings);

		const onError = (message: string) => {
			this._status.set('failed');
			this._error.set(this.withEngineOutput(message));
		};

		if (!definition.worker) return;
		this.transport = createWasmEngine(definition.worker, (line) => this.onLine(line), onError);

		const setOptions: string[] = [];
		if (definition.threads) setOptions.push(`name Threads value ${settings.threads}`);
		setOptions.push(`name Hash value ${settings.hashMb}`);
		setOptions.push(`name MultiPV value ${settings.multiPv}`);

		this.session = new UciSession(
			{
				send: (command) => this.transport?.send(command),
				onIdle: () => this._status.set('ready'),
				onWarning: (message) => this.onEngineWarning(message),
			},
			{ setOptions },
		);
		this.session.begin();
		this.search(fen);
	}

	private onEngineWarning(message: string): void {
		this.recentOutput.push(`[engine] ${message}`);
		if (this.recentOutput.length > 12) this.recentOutput.shift();
		console.warn(`[engine] ${message}`);
	}

	// What has to change for the engine to be rebuilt.
	private keyFor(definition: EngineDefinition, settings: EngineSettings): string {
		return [definition.id, settings.threads, settings.hashMb, settings.multiPv].join('|');
	}

	private search(fen: string): void {
		if (!this.session) return;

		this._lines.set([]);
		this._depth.set(0);
		this._status.set('searching');

		// Infinity is a legal setting: search until something else stops it.
		const seconds = this._settings().searchSeconds;
		this.session.search(fen, Number.isFinite(seconds) ? seconds * 1000 : null);
	}

	// The last few lines the engine printed, kept so a crash can be explained.
	private readonly recentOutput: string[] = [];

	private withEngineOutput(message: string): string {
		const tail = this.recentOutput.filter((line) => line.trim().length > 0).slice(-3);
		return tail.length > 0 ? `${message}\n${tail.join('\n')}` : message;
	}

	private onLine(line: string): void {
		this.recentOutput.push(line);
		if (this.recentOutput.length > 12) this.recentOutput.shift();

		this.session?.line(line);

		if (!this.session?.acceptsInfo) return;

		const parsed = parseInfoLine(line);
		if (!parsed) return;

		this._depth.set(parsed.depth);
		if (parsed.nps > 0) this._nps.set(parsed.nps);

		this._lines.update((lines) => {
			const next = lines.filter((existing) => existing.multipv !== parsed.multipv);
			next.push(parsed);
			return next;
		});
	}

	private shutDown(): void {
		this.session?.dispose();
		this.session = null;
		this.transport?.dispose();
		this.transport = null;
		this.loadedKey = '';
		this._lines.set([]);
		this._depth.set(0);
		this._nps.set(0);
		this._status.set('off');
		this._error.set(null);
	}

	readonly searchTimeSteps = SEARCH_TIME_STEPS;
}

function arrowFor(line: EngineLine, rank: number): DrawShape {
	const move = parseUciMove(line.pv[0] ?? '');
	return {
		orig: (move?.from ?? 'a1') as Key,
		dest: (move?.to ?? 'a1') as Key,
		// A brush of the engine's own, registered in ChessBoardComponent.
		brush: 'engine',
		modifiers: { lineWidth: ARROW_WIDTHS[Math.min(rank, ARROW_WIDTHS.length - 1)] },
	};
}
