import { describe, expect, it } from 'vitest';
import {
	DeviceCapabilities,
	hashStepsFor,
	maxThreads,
	recommendedHashMb,
	recommendedThreads,
	unsupportedReason,
} from './engine-capabilities';
import { engineById } from './engine-catalogue';

const MULTI = engineById('sf18-lite');
const SINGLE = engineById('sf18-lite-single');
const ASM = engineById('sf18-asm');
const LOCAL = engineById('local');

function device(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
	return { cores: 8, memoryGb: 8, isolated: true, ...overrides };
}

describe('recommendedThreads', () => {
	it('leaves one core to the page', () => {
		expect(recommendedThreads(device({ cores: 8 }), MULTI)).toBe(7);
	});

	it('never drops below one, however few cores are reported', () => {
		expect(recommendedThreads(device({ cores: 1 }), MULTI)).toBe(1);
	});

	it('is one on a build that cannot use threads at all', () => {
		expect(recommendedThreads(device({ cores: 16 }), SINGLE)).toBe(1);
		expect(maxThreads(device({ cores: 16 }), SINGLE)).toBe(1);
	});
});

describe('recommendedHashMb', () => {
	it('takes an eighth of the machine, rounded down to a power of two', () => {
		expect(recommendedHashMb(device({ memoryGb: 8 }), MULTI)).toBe(1024);
		expect(recommendedHashMb(device({ memoryGb: 4 }), MULTI)).toBe(512);
		expect(recommendedHashMb(device({ memoryGb: 0.5 }), MULTI)).toBe(64);
	});

	it('never exceeds what the build can address', () => {
		expect(recommendedHashMb(device({ memoryGb: 8 }), ASM)).toBe(256);
		expect(hashStepsFor(ASM).at(-1)).toBe(256);
	});

	it('guesses conservatively where the browser will not say', () => {
		expect(recommendedHashMb(device({ memoryGb: null }), MULTI)).toBe(256);
	});

	it('still returns a usable size on a machine too small for any step', () => {
		// An eighth of 0.25 GB is 32 MB, which is a step - that input never reached the fallback.
		// Below 0.125 GB the eighth lands under the smallest step and the floor is what answers.
		expect(recommendedHashMb(device({ memoryGb: 0.1 }), MULTI)).toBe(16);
	});
});

describe('the heap ceiling', () => {
	/** Every WASM wrapper guards emscripten_resize_heap at 2 GiB. */
	const CEILING_MB = 2048;

	it('never offers a hash size that could fill the heap on its own', () => {
		for (const id of ['sf18', 'sf18-single', 'sf18-lite', 'sf18-lite-single', 'sf18-asm']) {
			const engine = engineById(id);
			expect(engine.maxHashMb, id).toBeLessThan(CEILING_MB);
			expect(recommendedHashMb(device({ memoryGb: 64 }), engine), id).toBeLessThanOrEqual(engine.maxHashMb);
		}
	});

	it('leaves the full builds more headroom than the lite ones, because the network is 113MB', () => {
		expect(engineById('sf18-single').maxHashMb).toBeLessThan(engineById('sf18-lite-single').maxHashMb);
	});
});

describe('unsupportedReason', () => {
	it('passes a single-threaded build on a page that is not isolated', () => {
		expect(unsupportedReason(SINGLE, device({ isolated: false }))).toBeNull();
	});

	it('refuses a multi-threaded build on a page that is not isolated', () => {
		expect(unsupportedReason(MULTI, device({ isolated: false }))).toContain('cross-origin isolated');
	});

	it('allows it once the headers are in place', () => {
		expect(unsupportedReason(MULTI, device({ isolated: true }))).toBeNull();
	});

	it('refuses the local entry when the caller cannot see the agent at all', () => {
		expect(unsupportedReason(LOCAL, device())).toContain('Desktop Agent');
	});

	it('refuses it when the agent is there but no engine has been chosen', () => {
		const reason = unsupportedReason(LOCAL, device(), { connected: true, selected: false });
		expect(reason).toContain('No local engine is selected');
	});

	it('allows it once the agent is connected and an engine is chosen', () => {
		expect(unsupportedReason(LOCAL, device(), { connected: true, selected: true })).toBeNull();
	});
});
