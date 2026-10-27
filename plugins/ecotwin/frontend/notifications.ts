import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
/** Invalidations carry identity only; recipients reauthorize every fetch. */
@Injectable({ providedIn: 'root' })
export class SimulationNotifications implements OnDestroy {
  private readonly changes = new Subject<number | null>();
  readonly changed = this.changes.asObservable();
  private readonly channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel('symphony-simulation-reports');
  private readonly focus = () => this.changes.next(null);
  constructor() {
    if (this.channel)
      this.channel.onmessage = (event) => {
        if (Number.isInteger(event.data?.calculationId))
          this.changes.next(event.data.calculationId);
      };
    window.addEventListener('focus', this.focus);
  }
  publish(calculationId: number): void {
    this.channel?.postMessage({ calculationId });
    this.changes.next(calculationId);
  }
  ngOnDestroy(): void {
    this.channel?.close();
    window.removeEventListener('focus', this.focus);
    this.changes.complete();
  }
}
