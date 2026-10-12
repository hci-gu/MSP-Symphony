import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { environment } from '@src/environments/environment';
import { apiError, MareldApiClient } from './mareld-api.client';
import { exampleArea, prepareInput, PreparedInput } from './mareld-input';
import { DEFAULT_STEPS, MareldModel, MareldResult } from './mareld-result';
import { SymphonySelectionAdapter } from './symphony-selection.adapter';

@Injectable({ providedIn: 'root' })
export class MareldSession {
  private readonly api = inject(MareldApiClient);
  private readonly selection = inject(SymphonySelectionAdapter);
  readonly input = signal<PreparedInput | null>(null);
  readonly result = signal<MareldResult | null>(null);
  readonly models = signal<MareldModel[]>([]);
  readonly modelId = signal(environment.mareldPoc.modelId);
  readonly busy = signal(false);
  readonly discovering = signal(false);
  readonly error = signal('');
  readonly modelError = signal('');
  readonly frame = signal(0);
  readonly playing = signal(false);
  readonly species = signal(0);
  readonly opacity = signal(0.85);
  readonly maxSteps = signal(DEFAULT_STEPS);
  private revision = 0;
  private discoveryRevision = 0;
  private controller?: AbortController;
  private playbackTimer?: ReturnType<typeof setInterval>;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pausePlayback());
  }

  togglePlayback(): void {
    if (this.playing()) {
      this.pausePlayback();
      return;
    }
    const result = this.result();
    if (!result || result.steps.length < 2 || this.busy()) return;
    const lastFrame = result.steps.length - 1;
    if (this.frame() >= lastFrame) this.frame.set(0);
    this.playing.set(true);
    this.playbackTimer = setInterval(() => {
      if (this.result() !== result || this.busy()) {
        this.pausePlayback();
        return;
      }
      const nextFrame = Math.min(this.frame() + 1, lastFrame);
      this.frame.set(nextFrame);
      if (nextFrame === lastFrame) this.pausePlayback();
    }, 500);
  }

  pausePlayback(): void {
    if (this.playbackTimer !== undefined) clearInterval(this.playbackTimer);
    this.playbackTimer = undefined;
    this.playing.set(false);
  }

  seekFrame(frame: number): void {
    this.pausePlayback();
    const lastFrame = (this.result()?.steps.length ?? 1) - 1;
    if (Number.isFinite(frame)) this.frame.set(Math.max(0, Math.min(lastFrame, Math.round(frame))));
  }

  async capture(): Promise<void> {
    const revision = this.revision;
    this.error.set('');
    try {
      const input = await this.selection.capture();
      if (revision === this.revision) this.useInput(input);
    } catch (e) {
      if (revision === this.revision) this.error.set(apiError(e));
    }
  }

  useExample(): void {
    try {
      this.useInput(prepareInput(exampleArea(), 'Example 60 × 60 world'));
    } catch (e) {
      this.error.set(apiError(e));
    }
  }

  private useInput(input: PreparedInput): void {
    this.clearResult();
    this.input.set(input);
  }

  async discover(): Promise<void> {
    if (this.discovering()) return;
    const revision = ++this.discoveryRevision;
    this.discovering.set(true);
    this.modelError.set('');
    try {
      const models = await this.api.models();
      if (revision !== this.discoveryRevision) return;
      this.models.set(models);
      if (!models.some((m) => m.id === this.modelId())) this.modelId.set(models[0].id);
    } catch (e) {
      if (revision === this.discoveryRevision) {
        this.models.set([]);
        this.modelError.set(apiError(e));
      }
    } finally {
      if (revision === this.discoveryRevision) this.discovering.set(false);
    }
  }

  async run(): Promise<void> {
    const input = this.input();
    if (!input || this.busy()) return;
    this.pausePlayback();
    const revision = ++this.revision;
    this.controller = new AbortController();
    this.busy.set(true);
    this.error.set('');
    try {
      const model = this.models().find((m) => m.id === this.modelId());
      if (!model) throw new Error('Choose an available model before running the simulation.');
      const result = await this.api.run(input, model, this.maxSteps(), this.controller.signal);
      if (revision !== this.revision) return;
      this.frame.set(0);
      this.species.set(0);
      this.result.set(result);
    } catch (e) {
      if (revision === this.revision) this.error.set(apiError(e));
    } finally {
      if (revision === this.revision) this.busy.set(false);
    }
  }

  clearResult(): void {
    this.pausePlayback();
    this.invalidate();
    this.result.set(null);
    this.error.set('');
    this.frame.set(0);
    this.species.set(0);
  }

  reset(): void {
    this.clearResult();
    this.input.set(null);
    this.discoveryRevision++;
    this.discovering.set(false);
    this.modelError.set('');
  }

  private invalidate(): void {
    this.revision++;
    this.controller?.abort();
    this.controller = undefined;
    this.busy.set(false);
  }
}
