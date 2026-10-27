import { NgComponentOutlet } from '@angular/common';
import {
  Component,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  signal,
  SimpleChanges
} from '@angular/core';
import { HostExtensions, ReportContext, RenderState } from './extensions';

@Component({
  selector: 'app-report-extensions',
  standalone: true,
  imports: [NgComponentOutlet],
  template: `@if (missing().length) {
      <section role="alert">
        <h2>Requested extension unavailable</h2>
        <p>
          This report requires {{ missing().join(', ') }}. Its requested content cannot be displayed
          or printed.
        </p>
      </section>
    }
    @for (item of contributions; track item.id) {
      <ng-container *ngComponentOutlet="item.report!; inputs: inputs(item.id)" />
    }`
})
export class ReportOutletComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) context!: ReportContext;
  @Input() nativeReady = true;
  private readonly extensions = inject(HostExtensions);
  readonly contributions = this.extensions.items.filter((item) => item.report);
  readonly missing = signal<string[]>([]);
  private readonly states = new Map<string, RenderState>();
  private callbacks = new Map<string, (state: RenderState) => void>();
  private revision = 0;
  private publication = 0;
  inputs(id: string): Record<string, unknown> {
    return { context: this.context, renderState: this.callbacks.get(id) };
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['context']) {
      void this.publish();
      return;
    }
    const revision = ++this.revision;
    this.states.clear();
    this.callbacks = new Map();
    this.missing.set(
      this.extensions
        .required(this.context.query)
        .filter((id) => !this.contributions.some((item) => item.id === id))
    );
    for (const item of this.contributions) {
      this.states.set(item.id, 'loading');
      this.callbacks.set(item.id, (state) => {
        if (revision === this.revision) {
          this.states.set(item.id, state);
          void this.publish();
        }
      });
    }
    void this.publish();
  }
  private async publish(): Promise<void> {
    const publication = ++this.publication;
    const revision = this.revision;
    let state: RenderState =
      this.missing().length || [...this.states.values()].includes('error')
        ? 'error'
        : !this.nativeReady || [...this.states.values()].includes('loading')
          ? 'loading'
          : 'ready';
    if (state === 'ready') {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      try {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((image) => image.decode()));
      } catch {
        state = 'error';
      }
      if (
        publication !== this.publication ||
        revision !== this.revision ||
        !this.nativeReady ||
        [...this.states.values()].some((value) => value !== 'ready')
      )
        return;
    }
    document.documentElement.dataset['reportState'] = state;
    window.parent.postMessage(
      { type: 'reportState', documentId: this.context.query['reportDocument'] ?? '', state },
      window.origin
    );
  }
  ngOnDestroy(): void {
    this.publication++;
    this.revision++;
    delete document.documentElement.dataset['reportState'];
  }
}
