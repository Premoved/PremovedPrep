/** Wire types for the Desktop Agent bridge. */

export type AgentState =
	'idle' | 'unlinked' | 'searching' | 'offline' | 'unpaired' | 'connecting' | 'connected' | 'refused';

export interface AgentHello {
	readonly agent: string;
	readonly version: string;
	readonly protocol: number;
	readonly paired: boolean;
	readonly bridge: string;
}

export interface AgentSession {
	readonly protocol: number;
	readonly agent: string;
	readonly username: string;
	readonly keyId: number;
	readonly keyLabel: string;
	readonly engineSessions: readonly EngineSessionHandle[];
}

export interface EngineSessionHandle {
	readonly sessionId: string;
	readonly engineId: number;
	readonly engineName: string;
}

export interface LocalDatabaseCard {
	readonly id: number;
	readonly name: string;
	readonly games: number;
	readonly positions: number;
	/** Index depth in half-moves; 0 means whole games. */
	readonly maxPly: number;
	readonly bytes: number;
	readonly updatedAt: string;
}

export interface LocalEngineCard {
	readonly id: number;
	readonly name: string;
	readonly reportedName: string | null;
	readonly author: string | null;
	readonly threads: boolean;
	readonly maxThreads: number | null;
	readonly maxHashMb: number | null;
	readonly multiPv: boolean;
}

export interface BackupLocation {
	readonly parent: string;
	readonly root: string;
	readonly library: string;
	readonly white: string;
	readonly black: string;
	readonly exists: boolean;
}

export interface LocalFolderCollection {
	readonly id: string;
	readonly kind: 'LIBRARY' | 'REPERTOIRE';
	readonly color: 'w' | 'b' | null;
	readonly name: string;
	readonly relativePath: string;
	readonly itemCount: number;
	readonly truncated: boolean;
	readonly bytes: number;
	readonly updatedAt: string;
}

export interface LocalFolderEntry {
	readonly id: string;
	readonly itemType: string;
	readonly shape: 'DOCUMENT' | 'GAME';
	readonly title: string | null;
	readonly author: string | null;
	readonly white: string | null;
	readonly whiteElo: number | null;
	readonly black: string | null;
	readonly blackElo: number | null;
	readonly result: string | null;
	readonly event: string | null;
	readonly date: string | null;
	readonly year: number | null;
	readonly eco: string | null;
	readonly plyCount: number;
	readonly startFen: string | null;
	readonly updatedAt: string;
}

export interface LocalFolderEntryDetail extends LocalFolderEntry {
	readonly collectionId: string;
	readonly collectionName: string;
	readonly pgn: string;
}

export type AgentErrorCode = 'UNAUTHORIZED' | 'UNKNOWN_METHOD' | 'BAD_REQUEST' | 'NOT_FOUND' | 'FAILED';

export class AgentError extends Error {
	constructor(
		readonly code: AgentErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'AgentError';
	}
}

export interface AgentKeySummary {
	readonly id: number;
	readonly label: string;
	readonly prefix: string;
	readonly createdAt: string;
	readonly lastSeenAt: string | null;
	readonly revokedAt: string | null;
}

export interface NewAgentKey {
	readonly id: number;
	readonly label: string;
	readonly key: string;
	readonly prefix: string;
}

export type AgentRollout = 'PREVIEW' | 'BETA' | 'SUBSCRIPTION';

export interface AgentAccess {
	readonly allowed: boolean;
	/** Refusal reason when allowed is false: PREVIEW (not released) or PLAN (not purchased). */
	readonly reason: 'OK' | 'PREVIEW' | 'PLAN';
	readonly stage: AgentRollout;
	readonly insider: boolean;
}
