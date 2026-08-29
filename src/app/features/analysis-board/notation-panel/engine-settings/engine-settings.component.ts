import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MAX_MULTI_PV, hashStepsFor } from '../../../../core/engine/engine-capabilities';
import { AgentSelectionStore } from '../../../../core/agent/agent-selection.store';
import { ENGINE_CATALOGUE } from '../../../../core/engine/engine-catalogue';
import { EngineStore } from '../../state/engine.store';

/** A slider whose stops are a list rather than a range. */
interface StepSlider {
	readonly index: number;
	readonly max: number;
	readonly label: string;
	readonly markerPercent: number | null;
}

@Component({
	selector: 'app-engine-settings',
	standalone: true,
	imports: [],
	templateUrl: './engine-settings.component.html',
	styleUrl: './engine-settings.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EngineSettingsComponent {
	readonly engine = inject(EngineStore);
	private readonly agentSelection = inject(AgentSelectionStore);

	readonly catalogue = ENGINE_CATALOGUE;
	readonly maxMultiPv = MAX_MULTI_PV;

	readonly localEngineName = computed(() => this.agentSelection.engine()?.name ?? null);

	/** Search time */

	readonly searchTime = computed<StepSlider>(() => {
		const steps = this.engine.searchTimeSteps;
		const seconds = this.engine.settings().searchSeconds;
		const index = Math.max(0, steps.indexOf(seconds));
		return {
			index,
			max: steps.length - 1,
			label: Number.isFinite(seconds) ? `${seconds}s` : 'Unlimited',
			markerPercent: null,
		};
	});

	onSearchTime(event: Event): void {
		const index = readSlider(event);
		this.engine.updateSettings({ searchSeconds: this.engine.searchTimeSteps[index] });
	}

	/** Multiple lines */

	readonly multiPv = computed(() => this.engine.settings().multiPv);

	onMultiPv(event: Event): void {
		this.engine.updateSettings({ multiPv: readSlider(event) });
	}

	/** Threads */

	readonly threads = computed<StepSlider>(() => {
		const max = this.engine.maxThreads();
		const value = this.engine.settings().threads;
		return {
			index: value,
			max,
			label: `${value} / ${max}`,
			markerPercent: percentOf(this.engine.recommendedThreads() - 1, max - 1),
		};
	});

	onThreads(event: Event): void {
		this.engine.updateSettings({ threads: readSlider(event) });
	}

	/** Memory */

	readonly hashSteps = computed(() => hashStepsFor(this.engine.definition()));

	readonly hash = computed<StepSlider>(() => {
		const steps = this.hashSteps();
		const value = this.engine.settings().hashMb;
		const index = Math.max(0, steps.indexOf(value));
		return {
			index,
			max: steps.length - 1,
			label: `${value} MB`,
			markerPercent: percentOf(steps.indexOf(this.engine.recommendedHashMb()), steps.length - 1),
		};
	});

	onHash(event: Event): void {
		this.engine.updateSettings({ hashMb: this.hashSteps()[readSlider(event)] });
	}

	onEngine(event: Event): void {
		this.engine.selectEngine((event.target as HTMLSelectElement).value);
	}
}

function readSlider(event: Event): number {
	return Number.parseInt((event.target as HTMLInputElement).value, 10);
}

function percentOf(index: number, max: number): number | null {
	if (max <= 0 || index < 0 || index > max) return null;
	return (index / max) * 100;
}
