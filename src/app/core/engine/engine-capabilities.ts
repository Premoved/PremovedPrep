import { EngineDefinition } from './engine-catalogue';

export interface DeviceCapabilities {
	readonly cores: number;
	/** Approximate RAM in GB. Only Chromium reports it; null elsewhere. */
	readonly memoryGb: number | null;
	readonly isolated: boolean;
}

interface NavigatorWithMemory extends Navigator {
	readonly deviceMemory?: number;
}

export function readDeviceCapabilities(): DeviceCapabilities {
	const nav = navigator as NavigatorWithMemory;
	return {
		cores: Math.max(1, nav.hardwareConcurrency || 1),
		memoryGb: nav.deviceMemory ?? null,
		/** crossOriginIsolated reports whether the COOP/COEP headers arrived. */
		isolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false,
	};
}

export const HASH_STEPS_MB: readonly number[] = [16, 32, 64, 128, 256, 512, 1024, 2048];

export const SEARCH_TIME_STEPS: readonly number[] = [1, 2, 3, 5, 8, 12, 20, 30, 60, Infinity];

export const MAX_MULTI_PV = 5;

export function recommendedThreads(caps: DeviceCapabilities, engine: EngineDefinition): number {
	if (!engine.threads) return 1;
	return Math.max(1, caps.cores - 1);
}

export function maxThreads(caps: DeviceCapabilities, engine: EngineDefinition): number {
	return engine.threads ? Math.max(1, caps.cores) : 1;
}

/** An eighth of RAM, rounded down to a power of two, capped by the build's own ceiling. */
export function recommendedHashMb(caps: DeviceCapabilities, engine: EngineDefinition): number {
	const target = caps.memoryGb === null ? 256 : (caps.memoryGb * 1024) / 8;
	const affordable = HASH_STEPS_MB.filter((step) => step <= target && step <= engine.maxHashMb);
	return affordable.at(-1) ?? HASH_STEPS_MB[0];
}

export function hashStepsFor(engine: EngineDefinition): readonly number[] {
	return HASH_STEPS_MB.filter((step) => step <= engine.maxHashMb);
}

export interface LocalEngineAvailability {
	readonly connected: boolean;
	readonly selected: boolean;
}

export function unsupportedReason(
	engine: EngineDefinition,
	caps: DeviceCapabilities,
	local?: LocalEngineAvailability,
): string | null {
	if (engine.kind === 'local') {
		if (!local?.connected) {
			return 'The Desktop Agent is not connected. Open it, or set it up from the Desktop agent page.';
		}
		if (!local.selected) {
			return 'No local engine is selected. Choose one on the Desktop agent page.';
		}
		return null;
	}
	if (engine.requiresIsolation && !caps.isolated) {
		return 'Needs a cross-origin isolated page; this one is not isolated, so shared memory is unavailable.';
	}
	return null;
}
