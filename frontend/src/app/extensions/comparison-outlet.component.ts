import { NgComponentOutlet } from '@angular/common';
import { Component, EventEmitter, inject, Input, OnChanges, Output } from '@angular/core';
import { ComparisonContext, ComparisonContributionState, HostExtensions } from './extensions';

@Component({
  selector: 'app-comparison-extensions',
  standalone: true,
  imports: [NgComponentOutlet],
  template: `@for (item of contributions; track item.id) {
    <ng-container *ngComponentOutlet="item.comparison!; inputs: inputs(item.id)" />
  }`
})
export class ComparisonOutletComponent implements OnChanges {
  @Input({ required: true }) context!: ComparisonContext;
  @Output() stateChange = new EventEmitter<ComparisonContributionState>();
  readonly contributions = inject(HostExtensions).items.filter((item) => item.comparison);
  private readonly states = new Map<string, ComparisonContributionState>();
  private readonly callbacks = new Map<string, (state: ComparisonContributionState) => void>();
  inputs(id: string): Record<string, unknown> {
    if (!this.callbacks.has(id))
      this.callbacks.set(id, (state) => {
        this.states.set(id, state);
        this.publish();
      });
    return { context: this.context, stateChange: this.callbacks.get(id) };
  }
  ngOnChanges(): void {
    this.states.clear();
    this.publish();
  }
  private publish(): void {
    const values = [...this.states.values()];
    const query = Object.assign({}, ...values.map((value) => value.query));
    const required = values.flatMap((value) => value.query['extensions']?.split(',') ?? []);
    if (required.length) query.extensions = [...new Set(required)].join(',');
    this.stateChange.emit({ valid: values.every((value) => value.valid), query });
  }
}
