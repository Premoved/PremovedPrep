export interface EngineTransport {
	send(command: string): void;
	dispose(): void;
}

export type UciLineHandler = (line: string) => void;

/** Returned when the worker could not be constructed, so callers need no null checks. */
const DEAD_ENGINE: EngineTransport = {
	send: () => undefined,
	dispose: () => undefined,
};

export function createWasmEngine(
	workerUrl: string,
	onLine: UciLineHandler,
	onError: (message: string) => void,
): EngineTransport {
	let worker: Worker;
	try {
		worker = new Worker(workerUrl);
	} catch (error) {
		onError(`Could not start ${workerUrl}: ${error instanceof Error ? error.message : String(error)}`);
		return DEAD_ENGINE;
	}

	worker.onmessage = (event: MessageEvent<unknown>) => {
		if (typeof event.data === 'string') onLine(event.data);
	};

	worker.onerror = (event: ErrorEvent) => {
		void explainFailure(workerUrl, event.message).then(onError);
	};

	return {
		send: (command) => worker.postMessage(command),
		dispose: () => {
			/** quit lets Stockfish free its hash table; terminate alone leaks it until GC. */
			try {
				worker.postMessage('quit');
			} finally {
				worker.terminate();
			}
		},
	};
}

export function createLocalEngine(
	bridge: LocalEngineBridge,
	engineId: number,
	onLine: UciLineHandler,
	onError: (message: string) => void,
): EngineTransport {
	let sessionId: string | null = null;
	let disposed = false;

	/** Commands sent before the session id arrives. */
	const queued: string[] = [];

	const detachLine = bridge.on('engine.line', (data) => {
		const frame = data as { sessionId: string; line: string };
		if (frame.sessionId === sessionId) {
			onLine(frame.line);
		}
	});

	const detachClosed = bridge.on('engine.closed', (data) => {
		const frame = data as { sessionId: string };
		if (frame.sessionId === sessionId && !disposed) {
			onError('The engine on your computer stopped. Check the agent, then try again.');
		}
	});

	bridge
		.request<{ sessionId: string }>('engine.open', { engineId })
		.then((handle) => {
			if (disposed) {
				void bridge.request('engine.close', { sessionId: handle.sessionId });
				return;
			}
			sessionId = handle.sessionId;
			for (const command of queued.splice(0)) {
				void bridge.request('engine.send', { sessionId, command });
			}
		})
		.catch((error: Error) => onError(error.message));

	return {
		send: (command) => {
			if (disposed) return;
			if (sessionId === null) {
				queued.push(command);
				return;
			}
			void bridge.request('engine.send', { sessionId, command }).catch(() => undefined);
		},
		dispose: () => {
			disposed = true;
			detachLine();
			detachClosed();
			if (sessionId !== null) {
				void bridge.request('engine.close', { sessionId }).catch(() => undefined);
				sessionId = null;
			}
		},
	};
}

export interface LocalEngineBridge {
	request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
	on(event: string, handler: (data: unknown) => void): () => void;
}

async function explainFailure(workerUrl: string, message: string): Promise<string> {
	if (message) return `${workerUrl}: ${message}`;

	try {
		const response = await fetch(workerUrl, { method: 'HEAD' });
		if (!response.ok) {
			return `${workerUrl} returned ${response.status}. The engine binaries are copied from the "stockfish" package during the build - run "npm install" and restart the dev server.`;
		}
	} catch {
		// The probe only exists to sharpen the message; its own failure adds nothing to it.
	}
	return `${workerUrl} failed to start, and the browser did not say why. Check the console for the worker's own error.`;
}
