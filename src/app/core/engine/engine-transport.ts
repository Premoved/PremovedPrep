export interface EngineTransport {
	send(command: string): void;
	dispose(): void;
}

export type UciLineHandler = (line: string) => void;

// Returned when the worker could not be constructed, so callers need no null checks.
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
			try {
				// quit lets Stockfish free its hash table; terminate alone leaks it until GC.
				worker.postMessage('quit');
			} finally {
				worker.terminate();
			}
		},
	};
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
