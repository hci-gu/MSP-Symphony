import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Actions, ofType } from '@ngrx/effects';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UserActions } from '@data/user';
import { CalculationActions } from '@data/calculation';
import { environment } from '@src/environments/environment';
import { apiError, MareldApiClient } from './mareld-api.client';
import { prepareInput, PreparedInput } from './mareld-input';
import { DEFAULT_STEPS, MareldModel, MareldResult } from './mareld-result';
import { SymphonyCalculationAdapter } from './symphony-calculation.adapter';
import { CalculationInput } from './calculation-input';
import { compatibility, mapCalculation } from './simulation-input-mapping';
import { ImpactKind } from './mareld-impacts';
import { SimulationPersistenceClient } from './simulation-persistence.client';
import {
  SimulationReportData,
  SimulationSummary
} from '../simulation-reports/simulation-report-data.service';

interface CachedCalculation {
  input: PreparedInput;
  result: MareldResult | null;
  saved: boolean;
  modelId: string;
  maxSteps: number;
}

@Injectable({ providedIn: 'root' })
export class MareldSession {
  private readonly api = inject(MareldApiClient);
  readonly calculations = inject(SymphonyCalculationAdapter);
  private readonly persistence = inject(SimulationPersistenceClient);
  private readonly reports = inject(SimulationReportData);
  private readonly inputState = signal<PreparedInput | null>(null);
  readonly input = this.inputState.asReadonly();
  private readonly contextState = signal<CalculationInput | null>(null);
  readonly context = this.contextState.asReadonly();
  readonly selectedId = signal<number | null>(null);
  readonly loading = signal(false);
  readonly compatibilityErrors = computed(() =>
    this.context() ? compatibility(this.context()!) : []
  );
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
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal('');
  readonly history = signal<SimulationSummary[]>([]);
  readonly historyError = signal('');
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
  readonly preparedImpacts = computed(() => this.input()?.impacts ?? null);
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
  readonly canRun = computed(
    () =>
      !!this.input()?.source &&
      !this.busy() &&
      !this.loading() &&
      !this.saving() &&
      !this.discovering() &&
      !this.modelError() &&
      !this.compatibilityErrors().length &&
      (!this.result() || this.saved()) &&
      this.models().some((model) => model.id === this.modelId())
  );

  private revision = 0;
  private discoveryRevision = 0;
  private controller?: AbortController;
  private playbackTimer?: ReturnType<typeof setInterval>;
  // At most three input/result contexts, and at most 16 MiB of retained tensors.
  private readonly cache = new Map<number, CachedCalculation>();

  constructor() {
    inject(Actions)
      .pipe(ofType(UserActions.logoutUser), takeUntilDestroyed())
      .subscribe(() => this.reset());
    inject(Actions)
      .pipe(
        ofType(CalculationActions.deleteCalculation, CalculationActions.deleteMultipleCalculations),
        takeUntilDestroyed()
      )
      .subscribe((action) => {
        const ids =
          'calculationIds' in action ? action.calculationIds : [action.calculationToBeDeleted.id];
        ids.forEach((id) => this.cache.delete(id));
        if (this.selectedId() && ids.includes(this.selectedId()!)) this.reset();
      });
    inject(DestroyRef).onDestroy(() => this.reset());
  }

  selectModel(id: string): void {
    this.modelIdState.set(id);
  }
  setMaxSteps(steps: number): void {
    this.maxStepsState.set(steps);
  }
  selectSpecies(species: number): void {
    this.speciesState.set(species);
  }
  setOpacity(opacity: number): void {
    this.opacityState.set(opacity);
  }

  showImpact(kind: ImpactKind): void {
    if (this.preparedImpacts()?.layers.some((layer) => layer.kind === kind))
      this.previewImpactState.set(this.previewImpact() === kind ? null : kind);
  }
  setImpactOutline(kind: ImpactKind, visible: boolean): void {
    this.impactOutlinesState.update((outlines) => ({ ...outlines, [kind]: visible }));
  }

  private remember(): void {
    const input = this.input();
    if (!input?.source) return;
    this.cache.delete(input.source.calculationId);
    this.cache.set(input.source.calculationId, {
      input,
      result: this.result(),
      saved: this.saved(),
      modelId: this.modelId(),
      maxSteps: this.maxSteps()
    });
  }
  private trimCache(keep: number): void {
    const bytes = () =>
      [...this.cache.values()].reduce(
        (sum, item) => sum + (item.result?.values.byteLength ?? 0),
        0
      );
    for (const [id, item] of this.cache) {
      if (this.cache.size <= 3 && bytes() <= 16 * 1024 * 1024) break;
      if (id !== keep && (!item.result || item.saved)) this.cache.delete(id);
    }
  }

  async selectCalculation(id: number): Promise<void> {
    if (!Number.isInteger(id) || id < 1) return;
    this.remember();
    // Unsaved output remains available for retry; never evict it to satisfy a memory limit.
    const unsaved = [...this.cache.values()].filter((c) => c.result && !c.saved);
    if (unsaved.length >= 2 && !this.cache.has(id)) {
      this.errorState.set(
        'Save or explicitly clear an unsaved result before opening another calculation.'
      );
      return;
    }
    this.suspend();
    const revision = this.revision;
    this.selectedId.set(id);
    this.contextState.set(null);
    this.inputState.set(null);
    this.resultState.set(null);
    this.saved.set(false);
    this.saveError.set('');
    this.errorState.set('');
    this.history.set([]);
    this.historyError.set('');
    this.previewImpactState.set(null);
    this.frameState.set(0);
    this.speciesState.set(0);
    this.loading.set(true);
    try {
      const source = await this.calculations.context(id);
      if (revision !== this.revision) return;
      this.contextState.set(source);
      void this.loadHistory(id, revision);
      const cached = this.cache.get(id);
      if (cached?.input.source?.fingerprint === source.fingerprint) {
        this.inputState.set({ ...cached.input, name: source.name });
        this.resultState.set(cached.result);
        this.saved.set(cached.saved);
        this.modelIdState.set(cached.modelId);
        this.maxStepsState.set(cached.maxSteps);
      } else if (!compatibility(source).length) {
        if (!source.suggestedGrid)
          throw new Error('This calculation has no supported native grid.');
        const prepared = prepareInput(
          { type: 'Feature', properties: {}, geometry: source.geometry },
          source.name,
          source.suggestedGrid
        );
        const grid = await this.calculations.grid(source, prepared);
        if (revision !== this.revision) return;
        this.inputState.set(mapCalculation(prepared, source, grid));
        this.cache.delete(id);
      }
      this.remember();
      this.trimCache(id);
    } catch (error) {
      if (revision === this.revision) {
        this.errorState.set(apiError(error));
        this.cache.delete(id);
      }
    } finally {
      if (revision === this.revision) this.loading.set(false);
    }
  }

  async loadHistory(id = this.selectedId(), revision = this.revision): Promise<void> {
    if (!id) return;
    this.historyError.set('');
    try {
      const history = await this.reports.list(id);
      if (revision === this.revision) this.history.set(history);
    } catch (error) {
      if (revision === this.revision) this.historyError.set(apiError(error));
    }
  }

  async openSaved(runId: string): Promise<void> {
    const id = this.selectedId();
    if (!id || this.busy() || this.saving() || (this.result() && !this.saved())) return;
    this.suspend();
    const revision = this.revision;
    this.loading.set(true);
    this.errorState.set('');
    try {
      const result = await this.persistence.load(id, runId);
      if (revision !== this.revision) return;
      this.resultState.set(result);
      this.saved.set(true);
      this.frameState.set(0);
      this.speciesState.set(0);
      this.previewImpactState.set(null);
      this.remember();
      this.trimCache(id);
    } catch (error) {
      if (revision === this.revision) this.errorState.set(apiError(error));
    } finally {
      if (revision === this.revision) this.loading.set(false);
    }
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
    } catch (error) {
      if (revision === this.discoveryRevision) {
        this.modelsState.set([]);
        this.modelErrorState.set(apiError(error));
      }
    } finally {
      if (revision === this.discoveryRevision) this.discoveringState.set(false);
    }
  }

  async run(): Promise<void> {
    const input = this.input();
    if (!input || !this.canRun()) return;
    if ([...this.cache.values()].filter((item) => item.result && !item.saved).length >= 2) {
      this.errorState.set('Save or clear an unsaved result before starting another run.');
      return;
    }
    this.pausePlayback();
    const revision = ++this.revision;
    this.controller = new AbortController();
    this.busyState.set(true);
    this.errorState.set('');
    try {
      const model = structuredClone(this.models().find((m) => m.id === this.modelId())!);
      const runInput = structuredClone(input);
      this.previewImpactState.set(null);
      const result = await this.api.run(runInput, model, this.maxSteps(), this.controller.signal);
      if (revision !== this.revision) return;
      this.frameState.set(0);
      this.speciesState.set(0);
      this.resultState.set(result);
      this.saved.set(false);
      this.remember();
      this.trimCache(input.source!.calculationId);
      await this.saveResult();
    } catch (error) {
      if (revision === this.revision) this.errorState.set(apiError(error));
    } finally {
      if (revision === this.revision) this.busyState.set(false);
    }
  }

  async saveResult(): Promise<void> {
    const result = this.result();
    if (!result || this.saved() || this.saving()) return;
    const revision = this.revision;
    this.saving.set(true);
    this.saveError.set('');
    try {
      await this.persistence.save(result);
      // A save can finish after switching calculations; keep its original cache attribution.
      const cached = this.cache.get(result.input.source!.calculationId);
      if (cached?.result === result) cached.saved = true;
      if (revision === this.revision && this.result() === result) {
        this.saved.set(true);
        this.remember();
        await this.loadHistory();
      }
    } catch (error) {
      if (revision === this.revision) this.saveError.set(apiError(error));
    } finally {
      if (revision === this.revision) this.saving.set(false);
    }
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
      const next = Math.min(this.frame() + 1, lastFrame);
      this.frameState.set(next);
      if (next === lastFrame) this.pausePlayback();
    }, 500);
  }
  pausePlayback(): void {
    if (this.playbackTimer !== undefined) clearInterval(this.playbackTimer);
    this.playbackTimer = undefined;
    this.playingState.set(false);
  }
  seekFrame(frame: number): void {
    this.pausePlayback();
    const last = (this.result()?.steps.length ?? 1) - 1;
    if (Number.isFinite(frame)) this.frameState.set(Math.max(0, Math.min(last, Math.round(frame))));
  }
  clearResult(): void {
    this.suspend();
    this.resultState.set(null);
    this.saved.set(false);
    this.saveError.set('');
    this.errorState.set('');
    this.frameState.set(0);
    this.speciesState.set(0);
    this.remember();
  }
  /** Selection changes invalidate input/run work, without interrupting model discovery. */
  suspend(): void {
    this.pausePlayback();
    this.revision++;
    this.controller?.abort();
    this.controller = undefined;
    this.busyState.set(false);
    this.loading.set(false);
    this.saving.set(false);
  }
  /** Actual map destruction also invalidates pending discovery; tab hiding only pauses. */
  detach(): void {
    this.suspend();
    this.discoveryRevision++;
    this.discoveringState.set(false);
  }
  resume(): void {
    const id = this.selectedId();
    if (
      id &&
      !this.input() &&
      !this.loading() &&
      !this.error() &&
      !this.compatibilityErrors().length
    )
      void this.selectCalculation(id);
  }
  reset(): void {
    this.detach();
    this.cache.clear();
    this.inputState.set(null);
    this.resultState.set(null);
    this.contextState.set(null);
    this.selectedId.set(null);
    this.history.set([]);
    this.historyError.set('');
    this.saved.set(false);
    this.saveError.set('');
    this.errorState.set('');
    this.modelErrorState.set('');
    this.modelsState.set([]);
    this.previewImpactState.set(null);
    this.calculations.clear();
    this.impactOutlinesState.set({ noise: false, trawling: false });
  }
}
