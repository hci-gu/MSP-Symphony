import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  signal,
  ViewChild
} from '@angular/core';
import { MareldSession } from './mareld-session.service';
import { MareldMapBridge } from './mareld-map.bridge';
import { BIOMASS_GRADIENT } from './mareld-result';
import { speciesLabel } from './mareld-biomass';
import { stepsToDays } from '../mareld-shared/run-config';

@Component({
  selector: 'app-mareld-results',
  standalone: false,
  templateUrl: './mareld-results.component.html',
  styleUrls: ['./mareld-results.component.scss']
})
export class MareldResultsComponent {
  readonly session = inject(MareldSession);
  readonly map = inject(MareldMapBridge);
  readonly collapsed = signal(false);
  readonly speciesLabel = speciesLabel;
  readonly stepsToDays = stepsToDays;
  readonly gradient = BIOMASS_GRADIENT;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  @ViewChild('graphPanel') graph?: ElementRef<HTMLElement>;
  @ViewChild('playbackTray') tray?: ElementRef<HTMLElement>;

  constructor() {
    effect(() => {
      const result = this.session.result();
      this.collapsed();
      if (result) afterNextRender(() => this.fit(), { injector: this.injector });
    });
  }
  @HostListener('window:resize')
  fit(): void {
    const host = this.host.nativeElement;
    const left =
      host.getBoundingClientRect().left - (host.parentElement?.getBoundingClientRect().left ?? 0);
    const right = this.collapsed() ? 32 : (this.graph?.nativeElement.offsetWidth ?? 0) + 32;
    const bottom = (this.tray?.nativeElement.offsetHeight ?? 0) + 50;
    this.map.fit([32, right, bottom, left + 58]);
  }
}
