import { SimulationNotifications } from '../notifications';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_ECOTWIN_CONFIG } from '../config';
import { SimulationPersistenceClient } from './simulation-persistence.client';

describe('saved simulation deletion', () => {
  let client: SimulationPersistenceClient, http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    client = TestBed.inject(SimulationPersistenceClient);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('deletes the scoped run and notifies reports only after successful persistence', async () => {
    const notify = jasmine.createSpy('notify');
    TestBed.inject(SimulationNotifications).changed.subscribe(notify);
    const broadcast = spyOn(BroadcastChannel.prototype, 'postMessage');
    const deletion = client.delete(7, 'run-a');
    expect(notify).not.toHaveBeenCalled();
    const request = http.expectOne(`${DEFAULT_ECOTWIN_CONFIG.apiBaseUrl}/calculation/7/simulations/run-a`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await deletion;
    expect(broadcast).toHaveBeenCalledOnceWith({ calculationId: 7 });
    expect(notify).toHaveBeenCalledOnceWith(7);
  });
  it('propagates deletion failures without notifying reports', async () => {
    const notify = jasmine.createSpy('notify');
    TestBed.inject(SimulationNotifications).changed.subscribe(notify);
    const broadcast = spyOn(BroadcastChannel.prototype, 'postMessage');
    const deletion = client.delete(7, 'run-a');
    const assertion = expectAsync(deletion).toBeRejected();
    http
      .expectOne(`${DEFAULT_ECOTWIN_CONFIG.apiBaseUrl}/calculation/7/simulations/run-a`)
      .flush({ message: 'Access denied' }, { status: 403, statusText: 'Forbidden' });
    await assertion;
    expect(notify).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
