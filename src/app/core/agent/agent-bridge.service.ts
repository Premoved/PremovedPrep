import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { readToken } from '../interceptors/auth.interceptor';
import { AuthService } from '../services/auth.service';
import { AgentKeysStore } from './agent-keys.store';
import {
	AgentError,
	AgentErrorCode,
	AgentHello,
	AgentSession,
	AgentState,
	BackupLocation,
	LocalDatabaseCard,
	LocalEngineCard,
} from './agent.models';

/** Loopback ports the agent may listen on, probed in this order. */
const PORTS = [47599, 47600, 47601, 47602, 47603];

const PROBE_TIMEOUT_MS = 700;

export const SEARCH_WINDOW_MS = 20_000;

const PASS_INTERVAL_MS = 1_500;

/**
 * Bridge to the local Desktop Agent: port discovery, WebSocket session, JSON-RPC requests and pushed
 * events.
 */
@Injectable({ providedIn: 'root' })
export class AgentBridgeService {
	private readonly auth = inject(AuthService);
	private readonly keys = inject(AgentKeysStore);

	private readonly _state = signal<AgentState>('idle');
	private readonly _hello = signal<AgentHello | null>(null);
	private readonly _session = signal<AgentSession | null>(null);
	private readonly _databases = signal<readonly LocalDatabaseCard[]>([]);
	private readonly _engines = signal<readonly LocalEngineCard[]>([]);
	private readonly _error = signal<string | null>(null);
	private readonly _backup = signal<BackupLocation | null>(null);
	private readonly _catalogueLoaded = signal(false);
	private readonly _searchUntil = signal<number | null>(null);

	readonly state = this._state.asReadonly();
	readonly hello = this._hello.asReadonly();
	readonly session = this._session.asReadonly();
	readonly databases = this._databases.asReadonly();
	readonly engines = this._engines.asReadonly();
	readonly error = this._error.asReadonly();
	readonly backup = this._backup.asReadonly();
	readonly searchUntil = this._searchUntil.asReadonly();

	readonly connected = computed(() => this._state() === 'connected');

	readonly catalogueLoaded = this._catalogueLoaded.asReadonly();

	private socket: WebSocket | null = null;
	private origin: string | null = null;
	private nextId = 1;
	private searching = false;
	private hadSession = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	/** Set during a deliberate disconnect so onclose does not reconnect. */
	private closing = false;

	private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

	constructor() {
		effect(() => {
			const signedIn = this.auth.isLoggedIn();
			const known = this.keys.loaded();
			const linked = this.keys.anyLinked();

			if (!signedIn) {
				untracked(() => {
					this.disconnect();
					this._state.set('idle');
				});
				return;
			}
			if (!known) {
				return;
			}
			if (!linked) {
				untracked(() => {
					this.disconnect();
					this._state.set('unlinked');
				});
				return;
			}
			untracked(() => void this.connect());
		});

		this.on('pairing.ended', () => {
			this.disconnect();
			this._state.set('unpaired');
			this._hello.set(null);
		});
	}

	async connect(force = false): Promise<void> {
		if (!this.auth.isLoggedIn() || !this.keys.anyLinked()) {
			return;
		}
		if (this.searching) {
			return;
		}
		if (!force && (this._state() === 'connected' || this._state() === 'connecting')) {
			return;
		}
		if (force) {
			this.disconnect();
		}

		this.clearReconnect();
		this.searching = true;
		this._state.set('searching');
		this._error.set(null);

		const deadline = Date.now() + SEARCH_WINDOW_MS;
		this._searchUntil.set(deadline);

		try {
			for (;;) {
				const found = await this.probe();
				if (found) {
					this._hello.set(found.hello);
					this.origin = found.origin;

					if (!found.hello.paired) {
						this._state.set('unpaired');
						return;
					}

					this.open(found.origin);
					return;
				}

				if (Date.now() >= deadline) {
					this._state.set('offline');
					return;
				}
				await pause(Math.min(PASS_INTERVAL_MS, deadline - Date.now()));
			}
		} finally {
			this.searching = false;
			this._searchUntil.set(null);
		}
	}

	private async probe(): Promise<{ origin: string; hello: AgentHello } | null> {
		for (const port of PORTS) {
			const origin = `http://127.0.0.1:${port}`;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
			try {
				const response = await fetch(`${origin}/agent/hello`, {
					signal: controller.signal,
					credentials: 'omit',
					cache: 'no-store',
				});
				if (!response.ok) {
					continue;
				}
				const hello = (await response.json()) as AgentHello;
				/** Another service could be holding the port, so the agent name is checked. */
				if (hello.agent === 'PremovedPrep Agent') {
					return { origin, hello };
				}
			} catch {
				// Nothing listening on this origin, or not the agent: try the next one.
			} finally {
				clearTimeout(timer);
			}
		}
		return null;
	}

	private open(origin: string): void {
		this._state.set('connecting');
		const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/bridge`);
		this.socket = socket;

		socket.onopen = () => {
			const token = readToken();
			if (!token) {
				this.disconnect();
				this._state.set('idle');
				return;
			}
			this.request<AgentSession>('agent.hello', { token })
				.then((session) => {
					this._session.set(session);
					this._state.set('connected');
					this.hadSession = true;
					this._error.set(null);
					return this.refresh();
				})
				.catch((error: Error) => {
					/** Terminal: the agent is paired to a different account, so retrying will not help. */
					const refused = error instanceof AgentError && error.code === 'UNAUTHORIZED';
					this._state.set(refused ? 'refused' : 'offline');
					this._error.set(error.message);
					this.closeSocket();
				});
		};

		socket.onmessage = (event: MessageEvent<string>) => this.receive(event.data);

		socket.onclose = () => {
			this.socket = null;
			this._session.set(null);
			this.failPending(new Error('The connection to the agent was lost.'));
			if (this.closing) {
				this.closing = false;
				return;
			}
			if (this._state() !== 'refused') {
				this._state.set('offline');
				if (this.hadSession) {
					this.hadSession = false;
					this.scheduleReconnect();
				}
			}
		};

		socket.onerror = () => {
			// onclose always follows, and that is where the reconnect is scheduled.
		};
	}

	private scheduleReconnect(): void {
		this.clearReconnect();
		this.reconnectTimer = setTimeout(() => void this.connect(), 1_000);
	}

	private clearReconnect(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	disconnect(): void {
		this.clearReconnect();
		this.closeSocket();
		this.hadSession = false;
		this._session.set(null);
		this._databases.set([]);
		this._engines.set([]);
		this._backup.set(null);
		this._catalogueLoaded.set(false);
	}

	private closeSocket(): void {
		if (this.socket) {
			this.closing = true;
			this.socket.close();
			this.socket = null;
		}
	}

	async unpair(): Promise<void> {
		try {
			await this.request('agent.unpair');
		} catch {
			// Unpairing locally still has to happen, whether or not the agent heard it.
		} finally {
			this.disconnect();
			this._state.set('unpaired');
			this._hello.set(null);
		}
	}

	async refresh(): Promise<void> {
		if (!this.connected() && this._state() !== 'connecting') {
			return;
		}
		void this.locate();

		try {
			const [databases, engines] = await Promise.all([
				this.request<LocalDatabaseCard[]>('db.list'),
				this.request<LocalEngineCard[]>('engine.list'),
			]);
			this._databases.set(databases);
			this._engines.set(engines);
			this._catalogueLoaded.set(true);
		} catch (error) {
			this._error.set(error instanceof Error ? error.message : String(error));
		}
	}

	private async locate(): Promise<void> {
		try {
			this._backup.set(await this.request<BackupLocation>('store.location'));
		} catch {
			this._backup.set(null);
		}
	}

	request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new AgentError('FAILED', 'The agent is not connected.'));
		}

		const id = String(this.nextId++);
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	}

	on(event: string, handler: (data: unknown) => void): () => void {
		const handlers = this.listeners.get(event) ?? new Set();
		handlers.add(handler);
		this.listeners.set(event, handlers);
		return () => handlers.delete(handler);
	}

	private receive(payload: string): void {
		let frame: {
			id?: string;
			ok?: boolean;
			result?: unknown;
			error?: { code: AgentErrorCode; message: string };
			event?: string;
			data?: unknown;
		};
		try {
			frame = JSON.parse(payload);
		} catch {
			return;
		}

		if (frame.event) {
			this.listeners.get(frame.event)?.forEach((handler) => handler(frame.data));
			return;
		}

		if (!frame.id) {
			return;
		}
		const waiting = this.pending.get(frame.id);
		if (!waiting) {
			return;
		}
		this.pending.delete(frame.id);

		if (frame.ok) {
			waiting.resolve(frame.result);
		} else {
			waiting.reject(new AgentError(frame.error?.code ?? 'FAILED', frame.error?.message ?? 'The agent failed.'));
		}
	}

	private failPending(error: Error): void {
		for (const waiting of this.pending.values()) {
			waiting.reject(error);
		}
		this.pending.clear();
	}
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
