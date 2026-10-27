import { EcoTwinCapabilities } from '../capabilities';
import { CALCULATIONS, HOST_LIFECYCLE } from '../ports';
import { SimulationNotifications } from '../notifications';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ECOTWIN_CONFIG } from '../config';
import { EcoTwinApiClient } from './ecotwin-api.client';
import { apiError } from '../shared/api-error';
import { prepareInput, PreparedInput } from './ecotwin-input';
import { DEFAULT_STEPS, EcoTwinModel, EcoTwinResult, sampleEvery } from './ecotwin-result';
import { ECOTWIN_RUN } from '../shared/run-config';
import { CalculationInput } from './calculation-input';
import { compatibility, mapCalculation } from './simulation-input-mapping';
import { fullRunRequest, SimulationJob, SimulationJobsClient } from './simulation-jobs.client';
import { ImpactKind } from './ecotwin-impacts';
import { SimulationPersistenceClient } from './simulation-persistence.client';
import { SimulationReportData } from '../reports/simulation-report-data.service';
import type { SimulationSummary } from '../contracts';

interface CachedCalculation {
  input: PreparedInput;
  result: EcoTwinResult | null;
  saved: boolean;
  modelId: string;
  maxSteps: number;
  previewSteps: number;
  seed: number;
}

@Injectable({ providedIn: 'root' })
export class SimulationWorkspace {
  private readonly config = inject(ECOTWIN_CONFIG);
  private readonly notifications = inject(SimulationNotifications);
  readonly capabilities = inject(EcoTwinCapabilities);
  private readonly api = inject(EcoTwinApiClient);
  private readonly jobsClient = inject(SimulationJobsClient);
  readonly jobs = signal<SimulationJob[]>([]);
  readonly jobsError = signal('');
  readonly jobsLoading = signal(false);
  private jobRequest = 0;
  readonly submitting = signal(false);
  readonly activeJob = computed(() =>
    this.jobs().find((job) => job.status === 'queued' || job.status === 'running')
  );
  readonly previewSteps = signal(200);
  readonly seed = signal(42);
  readonly playbackSpeed = signal(1);
  readonly previewOutdated = computed(
    () => this.result()?.kind === 'preview' && this.result()?.draftKey !== this.draftKey()
  );
  private jobTimer?: ReturnType<typeof setTimeout>;
  private watchedRunId?: string;
  private submissionRevision = 0;
  private pendingSubmission?: ReturnType<typeof fullRunRequest>;
  readonly submissionUncertain = signal(false);
  readonly calculations = inject(CALCULATIONS);
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
  private readonly resultState = signal<EcoTwinResult | null>(null);
  readonly result = this.resultState.asReadonly();
  private readonly modelsState = signal<EcoTwinModel[]>([]);
  readonly models = this.modelsState.asReadonly();
  private readonly modelIdState = signal(this.config.modelId);
  readonly modelId = this.modelIdState.asReadonly();
  private readonly busyState = signal(false);
  readonly previewBusy = this.busyState.asReadonly();
  readonly busy = computed(() => this.previewBusy() || this.submitting() || !!this.activeJob());
  private readonly discoveringState = signal(false);
  readonly discovering = this.discoveringState.asReadonly();
  readonly preparingComparison = signal(false);
  readonly preparationNote = signal('');
  private preparationRevision = 0;
  private discoveryPromise?: Promise<void>;
  private readonly errorState = signal('');
  readonly error = this.errorState.asReadonly();
  private readonly modelErrorState = signal('');
  readonly modelError = this.modelErrorState.asReadonly();
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal('');
  readonly history = signal<SimulationSummary[]>([]);
  readonly historyError = signal('');
  readonly deletingRunId = signal<string | null>(null);
  readonly deleteError = signal('');
  readonly selectedRunId = computed(() => (this.saved() ? (this.result()?.id ?? null) : null));
  private deletionRevision = 0;
  private readonly deletedRuns = new Set<string>();
  private historyRequest = 0;
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
      this.capabilities.execution() &&
      !!this.input()?.source &&
      !this.busy() &&
      !this.loading() &&
      !this.saving() &&
      !this.deletingRunId() &&
      !this.discovering() &&
      !this.preparingComparison() &&
      !this.modelError() &&
      !this.compatibilityErrors().length &&
      !this.submissionUncertain() &&
      !this.jobsLoading() &&
      !this.jobsError() &&
      Number.isInteger(this.seed()) &&
      this.seed() >= 0 &&
      this.seed() <= 2147483637 &&
      Number.isInteger(this.maxSteps()) &&
      this.maxSteps() >= 1 &&
      this.maxSteps() <= 10000 &&
      Number.isInteger(this.previewSteps()) &&
      this.previewSteps() >= 1 &&
      this.previewSteps() <= this.maxSteps() &&
      this.models().some((model) => model.id === this.modelId())
  );

  private revision = 0;
  private discoveryRevision = 0;
  private controller?: AbortController;
  private playbackTimer?: ReturnType<typeof setInterval>;
  // At most three input/result contexts, and at most 16 MiB of retained tensors.
  private readonly cache = new Map<number, CachedCalculation>();

  constructor() {
    inject(HOST_LIFECYCLE).pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type === 'logout') this.reset();
      else { event.ids.forEach(id => this.cache.delete(id)); if (this.selectedId() && event.ids.includes(this.selectedId()!)) this.reset(); }
    });
    inject(DestroyRef).onDestroy(() => this.reset());
  }

  selectModel(id: string): void {
    this.modelIdState.set(id);
  }
  setMaxSteps(steps: number): void {
    this.maxStepsState.set(steps);
    if (Number.isInteger(steps) && steps > 0 && this.previewSteps() > steps)
      this.previewSteps.set(steps);
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
      maxSteps: this.maxSteps(),
      previewSteps: this.previewSteps(),
      seed: this.seed()
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
      if (id !== keep && (!item.result || item.saved || item.result.kind === 'preview'))
        this.cache.delete(id);
    }
  }

  async selectCalculation(id: number): Promise<void> {
    if (!Number.isInteger(id) || id < 1 || this.submitting() || this.submissionUncertain()) return;
    this.preparationRevision++;
    this.preparingComparison.set(false);
    this.preparationNote.set('');
    this.remember();
    // Unsaved output remains available for retry; never evict it to satisfy a memory limit.
    const unsaved = [...this.cache.values()].filter(
      (c) => c.result && !c.saved && c.result.kind !== 'preview'
    );
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
    this.deleteError.set('');
    this.jobs.set([]);
    this.jobsError.set('');
    this.watchedRunId = undefined;
    this.previewImpactState.set(null);
    this.frameState.set(0);
    this.speciesState.set(0);
    this.loading.set(true);
    try {
      if (!this.capabilities.execution()) { await this.loadHistory(id, revision); return; }
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
        this.previewSteps.set(cached.previewSteps);
        this.seed.set(cached.seed);
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
      void this.loadJobs();
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
    const request = ++this.historyRequest;
    this.historyError.set('');
    try {
      const history = await this.reports.list(id);
      if (revision === this.revision && request === this.historyRequest)
        this.history.set(history.filter((run) => !this.deletedRuns.has(run.runId)));
    } catch (error) {
      if (revision === this.revision && request === this.historyRequest)
        this.historyError.set(apiError(error));
    }
  }

  async deleteSaved(runId: string): Promise<void> {
    const id = this.selectedId();
    if (
      !id ||
      this.deletingRunId() ||
      this.loading() ||
      this.previewBusy() ||
      this.submitting() ||
      this.saving()
    )
      return;
    if (!this.history().some((run) => run.runId === runId)) return;
    const revision = ++this.deletionRevision;
    this.deletingRunId.set(runId);
    this.deleteError.set('');
    try {
      await this.persistence.delete(id, runId);
      if (revision !== this.deletionRevision) return;
      this.deletedRuns.add(runId);
      const cached = this.cache.get(id);
      if (cached?.result?.id === runId) {
        cached.result = null;
        cached.saved = false;
      }
      if (this.selectedId() === id) {
        this.history.update((runs) => runs.filter((run) => run.runId !== runId));
        this.jobs.update((jobs) => jobs.filter((job) => job.runId !== runId));
        if (this.watchedRunId === runId) this.watchedRunId = undefined;
        if (this.result()?.id === runId) this.clearResult();
      }
    } catch (error) {
      if (revision === this.deletionRevision && this.selectedId() === id)
        this.deleteError.set(apiError(error));
    } finally {
      if (revision === this.deletionRevision) this.deletingRunId.set(null);
    }
  }

  async openSaved(runId: string): Promise<void> {
    const id = this.selectedId();
    if (
      !id ||
      this.previewBusy() ||
      this.submitting() ||
      this.saving() ||
      this.deletingRunId() ||
      this.deletedRuns.has(runId)
    )
      return;
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
      if (revision === this.revision) {
        this.loading.set(false);
        void this.loadJobs();
      }
    }
  }

  discover(): Promise<void> {
    if (!this.capabilities.execution()) return Promise.resolve();
    if (this.discovering() && this.discoveryPromise) return this.discoveryPromise;
    this.discoveryPromise = this.discoverModels();
    return this.discoveryPromise;
  }

  private async discoverModels(): Promise<void> {
    const revision = ++this.discoveryRevision;
    this.discoveringState.set(true);
    this.modelErrorState.set('');
    try {
      const models = await this.api.models();
      if (revision !== this.discoveryRevision) return;
      this.modelsState.set(models);
      if (models.length && !models.some((m) => m.id === this.modelId()))
        this.modelIdState.set(models[0].id);
    } catch (error) {
      if (revision === this.discoveryRevision) {
        this.modelsState.set([]);
        this.modelErrorState.set(apiError(error));
      }
    } finally {
      if (revision === this.discoveryRevision) this.discoveringState.set(false);
    }
  }

  async prepareComparison(id: number, matchCalculation?: number, matchRun?: string): Promise<void> {
    const selection = this.selectCalculation(id);
    const revision = ++this.preparationRevision;
    this.preparingComparison.set(true);
    const current = () => revision === this.preparationRevision && this.selectedId() === id;
    try {
      await selection;
      if (!current() || !this.input()) return;
      if (!matchCalculation || !matchRun) return;
      const [runs] = await Promise.all([this.reports.list(matchCalculation), this.discover()]);
      if (!current()) return;
      const match = runs.find(
        (run) => run.runId === matchRun && run.calculationId === matchCalculation
      );
      if (!match)
        throw new Error(
          'The simulation to match is no longer available. Return to Compare calculations and choose another run.'
        );
      if (!this.models().some((model) => model.id === match.model.id))
        throw new Error(
          'The model version used by the selected simulation is no longer available.'
        );
      if (
        match.config.sampleEvery !== sampleEvery(match.config.maxSteps) ||
        match.config.tickDurationDays !== ECOTWIN_RUN.tickDurationDays ||
        match.config.mappingVersion !== this.input()?.impacts?.version
      )
        throw new Error(
          'The selected simulation uses different sampling or input mapping settings. Create a new matching pair.'
        );
      if (
        match.ensemble &&
        (match.ensemble.seeds.length !== 10 ||
          match.ensemble.seeds.some((seed, index) => seed !== match.config.seed + index))
      )
        throw new Error(
          'The selected simulation does not use the supported ten consecutive seeds.'
        );
      this.selectModel(match.model.id);
      this.setMaxSteps(match.config.maxSteps);
      this.seed.set(match.config.seed);
      this.preparationNote.set(
        `Settings copied from calculation #${matchCalculation}, simulation ${matchRun}. Review the inputs, then start a full run. ${match.ensemble ? 'The same ten seeds will be used.' : 'This is a legacy single-seed run; create a full ensemble for both calculations to compare confidence intervals.'}`
      );
    } catch (error) {
      if (current()) this.errorState.set(apiError(error));
    } finally {
      if (revision === this.preparationRevision) this.preparingComparison.set(false);
    }
  }

  async run(): Promise<void> {
    const input = this.input();
    if (!input || !this.canRun()) return;
    if (
      [...this.cache.values()].filter(
        (item) => item.result && !item.saved && item.result.kind !== 'preview'
      ).length >= 2
    ) {
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
      const draftKey = this.draftKey();
      const result = await this.api.run(
        runInput,
        model,
        this.previewSteps(),
        this.controller.signal,
        this.seed()
      );
      result.kind = 'preview';
      result.draftKey = draftKey;
      if (revision !== this.revision) return;
      this.frameState.set(0);
      this.speciesState.set(0);
      this.resultState.set(result);
      this.saved.set(false);
      this.remember();
      this.trimCache(input.source!.calculationId);
    } catch (error) {
      if (revision === this.revision) this.errorState.set(apiError(error));
    } finally {
      if (revision === this.revision) {
        this.busyState.set(false);
        void this.loadJobs();
      }
    }
  }

  async saveResult(): Promise<void> {
    const result = this.result();
    if (!result || result.kind === 'preview' || this.saved() || this.saving()) return;
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

  private draftKey(): string {
    return JSON.stringify([this.modelId(), this.seed(), this.previewSteps(), this.maxSteps()]);
  }
  setPlaybackSpeed(speed: number): void {
    if (![0.5, 1, 2, 4].includes(speed)) return;
    const playing = this.playing();
    this.pausePlayback();
    this.playbackSpeed.set(speed);
    if (playing) this.togglePlayback();
  }
  async runFull(): Promise<void> {
    if (!this.canRun() || !this.input()) return;
    this.pendingSubmission = fullRunRequest(
      this.input()!,
      this.models().find((m) => m.id === this.modelId())!,
      this.maxSteps(),
      this.seed()
    );
    await this.submitFull();
  }
  /** An uncertain HTTP outcome is retried with the exact frozen request/identity. */
  async submitFull(): Promise<void> {
    const request = this.pendingSubmission;
    if (!request || this.submitting()) return;
    const revision = ++this.submissionRevision;
    this.submitting.set(true);
    this.errorState.set('');
    this.pausePlayback();
    try {
      const job = await this.jobsClient.submit(request);
      if (revision !== this.submissionRevision) return;
      this.jobs.update((jobs) => [job, ...jobs.filter((item) => item.runId !== job.runId)]);
      this.watchedRunId = job.runId;
      this.pendingSubmission = undefined;
      this.submissionUncertain.set(false);
      void this.loadJobs();
    } catch (error) {
      if (revision === this.submissionRevision) {
        const uncertain =
          !(error instanceof HttpErrorResponse) ||
          error.status === 0 ||
          (error.status >= 500 && error.status !== 503);
        this.submissionUncertain.set(uncertain);
        if (!uncertain) this.pendingSubmission = undefined;
        this.errorState.set(apiError(error));
        void this.loadJobs();
      }
    } finally {
      if (revision === this.submissionRevision) this.submitting.set(false);
    }
  }
  async retryJob(runId: string): Promise<void> {
    const id = this.selectedId(),
      revision = this.revision;
    if (!id || this.busy()) return;
    try {
      const job = await this.jobsClient.retry(id, runId);
      if (revision !== this.revision) return;
      this.watchedRunId = runId;
      this.jobs.update((jobs) => jobs.map((item) => (item.runId === runId ? job : item)));
      void this.loadJobs();
    } catch (error) {
      if (revision === this.revision) this.jobsError.set(apiError(error));
    }
  }
  async loadJobs(): Promise<void> {
    if (!this.capabilities.execution()) return;
    if (this.jobTimer) clearTimeout(this.jobTimer);
    const id = this.selectedId(),
      revision = this.revision,
      request = ++this.jobRequest;
    if (!id) return;
    this.jobsLoading.set(true);
    try {
      const jobs = (await this.jobsClient.list(id)).filter(
        (job) => !this.deletedRuns.has(job.runId)
      );
      if (revision !== this.revision || request !== this.jobRequest) return;
      this.jobs.set(jobs);
      this.jobsError.set('');
      const submitted = jobs.find((job) => job.runId === this.pendingSubmission?.runId);
      if (submitted) {
        this.watchedRunId = submitted.runId;
        this.pendingSubmission = undefined;
        this.submissionUncertain.set(false);
      }
      const active = this.activeJob();
      if (active) this.watchedRunId = active.runId;
      const finished = jobs.find(
        (job) => job.runId === this.watchedRunId && job.status === 'completed'
      );
      if (finished) {
        this.jobsLoading.set(false);
        this.watchedRunId = undefined;
        await this.loadHistory();
        if (revision !== this.revision) return;
        await this.openSaved(finished.runId);
        this.notifications.publish(id);
        return;
      }
    } catch (error) {
      if (revision === this.revision) this.jobsError.set(apiError(error));
    }
    if (revision === this.revision && request === this.jobRequest) {
      this.jobsLoading.set(false);
      if (this.activeJob() || this.submissionUncertain() || this.jobsError())
        this.jobTimer = setTimeout(() => void this.loadJobs(), 5000);
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
    }, 500 / this.playbackSpeed());
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
    void this.loadJobs();
  }
  /** Selection changes invalidate input/run work, without interrupting model discovery. */
  suspend(): void {
    this.pausePlayback();
    this.revision++;
    if (this.jobTimer) clearTimeout(this.jobTimer);
    this.jobTimer = undefined;
    this.jobRequest++;
    this.jobsLoading.set(false);
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
    if (this.selectedId() && this.input()) void this.loadJobs();
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
    this.preparationRevision++;
    this.preparingComparison.set(false);
    this.preparationNote.set('');
    this.detach();
    this.cache.clear();
    this.deletionRevision++;
    this.deletingRunId.set(null);
    this.deleteError.set('');
    this.deletedRuns.clear();
    this.jobs.set([]);
    this.jobsError.set('');
    this.submissionRevision++;
    this.pendingSubmission = undefined;
    this.submissionUncertain.set(false);
    this.submitting.set(false);
    this.watchedRunId = undefined;
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
