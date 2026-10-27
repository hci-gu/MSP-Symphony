import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '@src/environments/environment';
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
    const notify = spyOn(window, 'dispatchEvent');
    const broadcast = spyOn(BroadcastChannel.prototype, 'postMessage');
    const deletion = client.delete(7, 'run-a');
    expect(notify).not.toHaveBeenCalled();
    const request = http.expectOne(`${environment.apiBaseUrl}/calculation/7/simulations/run-a`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await deletion;
    expect(broadcast).toHaveBeenCalledOnceWith({ calculationId: 7 });
    const event = notify.calls.mostRecent().args[0] as CustomEvent<number>;
    expect(event.type).toBe('simulation-deleted');
    expect(event.detail).toBe(7);
  });
  it('propagates deletion failures without notifying reports', async () => {
    const notify = spyOn(window, 'dispatchEvent');
    const broadcast = spyOn(BroadcastChannel.prototype, 'postMessage');
    const deletion = client.delete(7, 'run-a');
    const assertion = expectAsync(deletion).toBeRejected();
    http
      .expectOne(`${environment.apiBaseUrl}/calculation/7/simulations/run-a`)
      .flush({ message: 'Access denied' }, { status: 403, statusText: 'Forbidden' });
    await assertion;
    expect(notify).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
