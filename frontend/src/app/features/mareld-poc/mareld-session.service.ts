import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { environment } from '@src/environments/environment';
import { apiError, MareldApiClient } from './mareld-api.client';
import { exampleArea, prepareInput, PreparedInput } from './mareld-input';
import { DEFAULT_STEPS, MareldModel, MareldResult } from './mareld-result';
import { SymphonySelectionAdapter } from './symphony-selection.adapter';
import { MareldImpactData } from './mareld-impact-data.service';
import {
  defaultImpactSettings,
  IMPACT_DEFINITIONS,
  IMPACT_KINDS,
  ImpactKind,
  ImpactSettings,
  prepareImpact,
  PreparedImpacts
} from './mareld-impacts';

@Injectable({ providedIn: 'root' })
export class MareldSession {
  private readonly api = inject(MareldApiClient);
  private readonly selection = inject(SymphonySelectionAdapter);
  private readonly impactData = inject(MareldImpactData);
  private readonly inputState = signal<PreparedInput | null>(null);
  readonly input = this.inputState.asReadonly();
  private readonly resultState = signal<MareldResult | null>(null);
  readonly result = this.resultState.asReadonly();
  private readonly modelsState = signal<MareldModel[]>([]);
  readonly models = this.modelsState.asReadonly();
  private readonly modelIdState = signal(environment.mareldPoc.modelId);
  readonly modelId = this.modelIdState.asReadonly();
  private readonly busyState = signal(false);
  readonly busy = this.busyState.asReadonly();
  private readonly discoveringState = signal(false);
  readonly discovering = this.discoveringState.asReadonly();
  private readonly errorState = signal('');
  readonly error = this.errorState.asReadonly();
  private readonly modelErrorState = signal('');
  readonly modelError = this.modelErrorState.asReadonly();
  private readonly frameState = signal(0);
  readonly frame = this.frameState.asReadonly();
  private readonly playingState = signal(false);
  readonly playing = this.playingState.asReadonly();
  private readonly speciesState = signal(0);
  readonly species = this.speciesState.asReadonly();
  private readonly opacityState = signal(0.95);
  readonly opacity = this.opacityState.asReadonly();
  private readonly maxStepsState = signal(DEFAULT_STEPS);
  readonly maxSteps = this.maxStepsState.asReadonly();
  private readonly impactSettingsState = signal<ImpactSettings>(defaultImpactSettings());
  readonly impactSettings = this.impactSettingsState.asReadonly();
  private readonly preparedImpactsState = signal<PreparedImpacts | null>(null);
  readonly preparedImpacts = this.preparedImpactsState.asReadonly();
  private readonly preparingImpactsState = signal(false);
  readonly preparingImpacts = this.preparingImpactsState.asReadonly();
  private readonly impactErrorState = signal('');
  readonly impactError = this.impactErrorState.asReadonly();
  private readonly previewImpactState = signal<ImpactKind | null>(null);
  readonly previewImpact = this.previewImpactState.asReadonly();
  private readonly impactOutlinesState = signal<Record<ImpactKind, boolean>>({
    noise: false,
    trawling: false
  });
  readonly impactOutlines = this.impactOutlinesState.asReadonly();
  readonly mapImpacts = computed(() => {
    const result = this.result();
    if (result && !this.previewImpact())
      return { input: result.input, impacts: result.input.impacts ?? null, fromResult: true };
    return { input: this.input(), impacts: this.preparedImpacts(), fromResult: false };
  });
  readonly outlineLayers = computed(
    () => this.mapImpacts().impacts?.layers.filter((layer) => layer.affectedCells > 0) ?? []
  );
  readonly impactsEnabled = computed(() =>
    IMPACT_KINDS.some((kind) => this.impactSettings()[kind].enabled)
  );
  readonly impactsReady = computed(
    () =>
      !this.impactsEnabled() ||
      (!this.preparingImpacts() &&
        !this.impactError() &&
        this.preparedImpacts()?.inputId === this.input()?.id)
  );
  readonly canRun = computed(
    () =>
      !!this.input() &&
      !this.busy() &&
      !this.discovering() &&
      !this.modelError() &&
      this.impactsReady() &&
      this.models().some((model) => model.id === this.modelId())
  );

  private revision = 0;
  private discoveryRevision = 0;
  private impactRevision = 0;
  private controller?: AbortController;
  private playbackTimer?: ReturnType<typeof setInterval>;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pausePlayback());
  }

  selectModel(id: string): void {
    this.modelIdState.set(id);
  }

  setMaxSteps(steps: number): void {
    this.maxStepsState.set(steps);
  }

  setImpactEnabled(kind: ImpactKind, enabled: boolean): void {
    if (this.busy()) return;
    this.impactSettingsState.update((settings) => ({
      ...settings,
      [kind]: { ...settings[kind], enabled }
    }));
    void this.prepareImpacts();
  }

  setImpactStrength(kind: ImpactKind, strength: number): void {
    if (this.busy() || !Number.isFinite(strength) || strength < 0 || strength > 2) return;
    this.impactSettingsState.update((settings) => ({
      ...settings,
      [kind]: { ...settings[kind], strength }
    }));
    void this.prepareImpacts();
  }

  showImpact(kind: ImpactKind): void {
    if (this.preparedImpacts()?.layers.some((layer) => layer.kind === kind))
      this.previewImpactState.set(this.previewImpact() === kind ? null : kind);
  }

  setImpactOutline(kind: ImpactKind, visible: boolean): void {
    this.impactOutlinesState.update((outlines) => ({ ...outlines, [kind]: visible }));
  }

  async prepareImpacts(): Promise<void> {
    const revision = ++this.impactRevision;
    const input = this.input();
    const settings = this.impactSettings();
    this.preparedImpactsState.set(null);
    this.impactErrorState.set('');
    this.previewImpactState.set(null);
    const kinds = IMPACT_KINDS.filter((kind) => settings[kind].enabled);
    this.preparingImpactsState.set(!!input && !!kinds.length);
    if (!input || !kinds.length) return;
    try {
      const layers = await Promise.all(
        kinds.map(async (kind) => {
          const source = await this.impactData.load(kind);
          const layer = prepareImpact(input, kind, settings[kind].strength, source);
          if (!layer.coverage)
            throw new Error(
              `No ${IMPACT_DEFINITIONS[kind].title.toLowerCase()} source data covers this area. Use the MARELD review area or turn this impact off.`
            );
          return layer;
        })
      );
      if (revision !== this.impactRevision) return;
      this.preparedImpactsState.set({
        id: crypto.randomUUID(),
        inputId: input.id,
        version: 'symphony-demo-impacts-v1',
        settings: { noise: { ...settings.noise }, trawling: { ...settings.trawling } },
        layers
      });
    } catch (error) {
      if (revision === this.impactRevision) this.impactErrorState.set(apiError(error));
    } finally {
      if (revision === this.impactRevision) this.preparingImpactsState.set(false);
    }
  }

  selectSpecies(species: number): void {
    this.speciesState.set(species);
  }

  setOpacity(opacity: number): void {
    this.opacityState.set(opacity);
  }

  togglePlayback(): void {
    if (this.playing()) {
      this.pausePlayback();
      return;
    }
    const result = this.result();
    if (!result || result.steps.length < 2 || this.busy()) return;
    const lastFrame = result.steps.length - 1;
    if (this.frame() >= lastFrame) this.frameState.set(0);
    this.playingState.set(true);
    this.playbackTimer = setInterval(() => {
      if (this.result() !== result || this.busy()) {
        this.pausePlayback();
        return;
      }
      const nextFrame = Math.min(this.frame() + 1, lastFrame);
      this.frameState.set(nextFrame);
      if (nextFrame === lastFrame) this.pausePlayback();
    }, 500);
  }

  pausePlayback(): void {
    if (this.playbackTimer !== undefined) clearInterval(this.playbackTimer);
    this.playbackTimer = undefined;
    this.playingState.set(false);
  }

  seekFrame(frame: number): void {
    this.pausePlayback();
    const lastFrame = (this.result()?.steps.length ?? 1) - 1;
    if (Number.isFinite(frame))
      this.frameState.set(Math.max(0, Math.min(lastFrame, Math.round(frame))));
  }

  async capture(): Promise<void> {
    const revision = this.revision;
    this.errorState.set('');
    try {
      const input = await this.selection.capture();
      if (revision === this.revision) this.useInput(input);
    } catch (e) {
      if (revision === this.revision) this.errorState.set(apiError(e));
    }
  }

  useExample(): void {
    try {
      this.useInput(prepareInput(exampleArea(), 'Example 60 × 60 world'));
    } catch (e) {
      this.errorState.set(apiError(e));
    }
  }

  private useInput(input: PreparedInput): void {
    this.clearResult();
    this.inputState.set(input);
    void this.prepareImpacts();
  }

  async discover(): Promise<void> {
    if (this.discovering()) return;
    const revision = ++this.discoveryRevision;
    this.discoveringState.set(true);
    this.modelErrorState.set('');
    try {
      const models = await this.api.models();
      if (revision !== this.discoveryRevision) return;
      this.modelsState.set(models);
      if (!models.some((m) => m.id === this.modelId())) this.modelIdState.set(models[0].id);
    } catch (e) {
      if (revision === this.discoveryRevision) {
        this.modelsState.set([]);
        this.modelErrorState.set(apiError(e));
      }
    } finally {
      if (revision === this.discoveryRevision) this.discoveringState.set(false);
    }
  }

  async run(): Promise<void> {
    const input = this.input();
    if (!input || this.busy()) return;
    this.pausePlayback();
    const revision = ++this.revision;
    this.controller = new AbortController();
    this.busyState.set(true);
    this.errorState.set('');
    try {
      const model = this.models().find((m) => m.id === this.modelId());
      if (!model) throw new Error('Choose an available model before running the simulation.');
      if (!this.impactsReady())
        throw new Error(
          'Wait for the impact previews or resolve the impact input error before running.'
        );
      const runInput = this.impactsEnabled()
        ? { ...input, impacts: this.preparedImpacts()! }
        : input;
      this.previewImpactState.set(null);
      const result = await this.api.run(runInput, model, this.maxSteps(), this.controller.signal);
      if (revision !== this.revision) return;
      this.frameState.set(0);
      this.speciesState.set(0);
      this.resultState.set(result);
    } catch (e) {
      if (revision === this.revision) this.errorState.set(apiError(e));
    } finally {
      if (revision === this.revision) this.busyState.set(false);
    }
  }

  clearResult(): void {
    this.pausePlayback();
    this.invalidate();
    this.resultState.set(null);
    this.errorState.set('');
    this.frameState.set(0);
    this.speciesState.set(0);
  }

  reset(): void {
    this.clearResult();
    this.inputState.set(null);
    this.impactRevision++;
    this.impactSettingsState.set(defaultImpactSettings());
    this.impactOutlinesState.set({ noise: false, trawling: false });
    this.preparedImpactsState.set(null);
    this.preparingImpactsState.set(false);
    this.impactErrorState.set('');
    this.previewImpactState.set(null);
    this.discoveryRevision++;
    this.discoveringState.set(false);
    this.modelErrorState.set('');
  }

  private invalidate(): void {
    this.revision++;
    this.controller?.abort();
    this.controller = undefined;
    this.busyState.set(false);
  }
}
