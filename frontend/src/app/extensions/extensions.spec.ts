import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  provideZonelessChangeDetection,
  signal
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NgComponentOutlet } from '@angular/common';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { HOST_EXTENSIONS, HostExtensions, RenderState, ReportContext } from './extensions';
import { ReportOutletComponent } from './report-outlet.component';
import {
  SlideViewComponent,
  SlideViewTabComponent
} from '../shared/slide-view/slide-view.component';
import { IconComponent } from '../shared/icon/icon.component';

@Component({
  selector: 'app-test-report-part',
  standalone: true,
  template: '<p>Extension report content</p>'
})
class ReportPart implements OnChanges {
  @Input() context!: ReportContext;
  @Input() renderState!: (state: RenderState) => void;
  ngOnChanges(): void {
    this.renderState('loading');
  }
}
@Component({ selector: 'app-test-workspace', standalone: true, template: '<p>Workspace</p>' })
class Workspace implements OnDestroy {
  static destroyed = 0;
  ngOnDestroy(): void {
    Workspace.destroyed++;
  }
}
@Component({
  selector: 'app-test-tabs',
  standalone: false,
  template: ` <app-slide-view
    [open]="open()"
    initialTabId="fixture"
    [compoundComparisonCount$]="count"
    (navigate)="active = $event"
  >
    <app-slide-view-tab id="native" title="Native" />
    @for (item of items; track item.id) {
      <app-slide-view-tab [id]="item.id" [title]="item.title">
        @if (open() && active === item.id) {
          <ng-container *ngComponentOutlet="item.panel" />
        }
      </app-slide-view-tab>
    }
  </app-slide-view>`
})
class Tabs {
  open = signal(true);
  active = '';
  count = of(0);
  items = [{ id: 'fixture', title: 'Fixture', panel: Workspace }];
}

const settle = async () => {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
  await document.fonts.ready;
  await Promise.resolve();
};
describe('optional host contributions', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] })
  );
  it('has no workspaces or map side effects with the default registry', () => {
    const registry = TestBed.inject(HostExtensions);
    expect(registry.workspaces).toEqual([]);
    expect(registry.items).toEqual([]);
  });
  it('makes a native report ready without any installed extension', async () => {
    const notify: jasmine.Spy = spyOn(window.parent, 'postMessage');
    const fixture = TestBed.createComponent(ReportOutletComponent);
    fixture.componentRef.setInput('context', {
      kind: 'calculation',
      calculationId: 7,
      query: { reportDocument: 'native-document' }
    });
    fixture.detectChanges();
    await settle();
    expect(notify).toHaveBeenCalledWith(
      { type: 'reportState', documentId: 'native-document', state: 'ready' },
      window.origin
    );
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });
  it('waits for native report content before allowing an otherwise ready report to print', async () => {
    const notify: jasmine.Spy = spyOn(window.parent, 'postMessage');
    const fixture = TestBed.createComponent(ReportOutletComponent);
    fixture.componentRef.setInput('context', {
      kind: 'calculation',
      calculationId: 7,
      query: { reportDocument: 'metadata-pending' }
    });
    fixture.componentRef.setInput('nativeReady', false);
    fixture.detectChanges();
    await settle();
    expect(notify).not.toHaveBeenCalledWith(
      { type: 'reportState', documentId: 'metadata-pending', state: 'ready' },
      window.origin
    );
    fixture.componentRef.setInput('nativeReady', true);
    fixture.detectChanges();
    await settle();
    expect(notify).toHaveBeenCalledWith(
      { type: 'reportState', documentId: 'metadata-pending', state: 'ready' },
      window.origin
    );
    fixture.componentRef.setInput('nativeReady', false);
    fixture.detectChanges();
    expect(notify.calls.mostRecent().args[0].state).toBe('loading');
  });
  it('reports a required missing extension explicitly and never reports ready', async () => {
    const notify: jasmine.Spy = spyOn(window.parent, 'postMessage');
    const fixture = TestBed.createComponent(ReportOutletComponent);
    fixture.componentRef.setInput('context', {
      kind: 'comparison',
      query: { reportDocument: 'missing-document', extensions: 'fixture' }
    });
    fixture.detectChanges();
    await settle();
    expect(fixture.nativeElement.textContent).toContain('Requested extension unavailable');
    expect(notify).toHaveBeenCalledWith(
      { type: 'reportState', documentId: 'missing-document', state: 'error' },
      window.origin
    );
    expect(notify).not.toHaveBeenCalledWith(
      { type: 'reportState', documentId: 'missing-document', state: 'ready' },
      window.origin
    );
  });
  it('waits for installed contributions and ignores callbacks from a previous document', async () => {
    TestBed.overrideProvider(HOST_EXTENSIONS, {
      useValue: [{ id: 'fixture', report: ReportPart }]
    });
    const notify: jasmine.Spy = spyOn(window.parent, 'postMessage');
    const fixture = TestBed.createComponent(ReportOutletComponent);
    fixture.componentRef.setInput('context', {
      kind: 'calculation',
      calculationId: 7,
      query: { reportDocument: 'first' }
    });
    fixture.detectChanges();
    const part = fixture.debugElement.query(By.directive(ReportPart))
      .componentInstance as ReportPart;
    const oldCallback = part.renderState;
    fixture.componentRef.setInput('context', {
      kind: 'calculation',
      calculationId: 9,
      query: { reportDocument: 'second' }
    });
    fixture.detectChanges();
    oldCallback('ready');
    await settle();
    expect(notify).not.toHaveBeenCalledWith(
      { type: 'reportState', documentId: 'second', state: 'ready' },
      window.origin
    );
    part.renderState('ready');
    await settle();
    expect(notify).toHaveBeenCalledWith(
      { type: 'reportState', documentId: 'second', state: 'ready' },
      window.origin
    );
    part.renderState('error');
    expect(notify).toHaveBeenCalledWith(
      { type: 'reportState', documentId: 'second', state: 'error' },
      window.origin
    );
  });
  it('discards old image-readiness work after a same-document artifact refresh', async () => {
    TestBed.overrideProvider(HOST_EXTENSIONS, {
      useValue: [{ id: 'fixture', report: ReportPart }]
    });
    const notify: jasmine.Spy = spyOn(window.parent, 'postMessage');
    const pendingImage = document.createElement('img');
    const releases: (() => void)[] = [];
    spyOn(pendingImage, 'decode').and.callFake(
      () => new Promise<void>((resolve) => releases.push(resolve))
    );
    document.body.appendChild(pendingImage);
    try {
      const fixture = TestBed.createComponent(ReportOutletComponent);
      fixture.componentRef.setInput('context', {
        kind: 'calculation',
        calculationId: 7,
        query: { reportDocument: 'same-document' }
      });
      fixture.detectChanges();
      const part = fixture.debugElement.query(By.directive(ReportPart))
        .componentInstance as ReportPart;
      part.renderState('ready');
      await settle();
      expect(releases.length).toBe(1);
      part.renderState('loading');
      part.renderState('ready');
      await settle();
      expect(releases.length).toBe(2);
      notify.calls.reset();
      releases[0]();
      await settle();
      expect(notify).not.toHaveBeenCalled();
      releases[1]();
      await settle();
      expect(notify).toHaveBeenCalledWith(
        { type: 'reportState', documentId: 'same-document', state: 'ready' },
        window.origin
      );
    } finally {
      pendingImage.remove();
    }
  });
  it('discovers host-rendered extension tabs, activates deep links and disposes hidden content', async () => {
    TestBed.configureTestingModule({
      imports: [NgComponentOutlet],
      declarations: [Tabs, SlideViewComponent, SlideViewTabComponent, IconComponent],
      providers: [provideNoopAnimations()]
    });
    const fixture = TestBed.createComponent(Tabs);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    const slides = fixture.debugElement.query(By.directive(SlideViewComponent))
      .componentInstance as SlideViewComponent;
    expect(slides.tabs.map((tab) => tab.id)).toEqual(['native', 'fixture']);
    expect(fixture.componentInstance.active).toBe('fixture');
    expect(fixture.nativeElement.querySelector('app-test-workspace')).not.toBeNull();
    const before = Workspace.destroyed;
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(Workspace.destroyed).toBe(before + 1);
  });
});
