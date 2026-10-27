import { CALCULATIONS, HOST_LIFECYCLE, HostLifecycleEvent } from '../../ports';
import { EcoTwinCapabilities } from '../../capabilities';
import { SimulationJobsClient } from '../simulation-jobs.client';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { EcoTwinApiClient } from '../ecotwin-api.client';
import { SimulationPersistenceClient } from '../simulation-persistence.client';
import { SimulationReportData } from '../../reports/simulation-report-data.service';
import { calculationFixture } from '../testing/calculation.fixture';

export function sessionProviders() {
  const api = jasmine.createSpyObj('API', ['models', 'run']);
  api.models.and.resolveTo([{ id: 'test', name: 'Test model', species: ['codfish'] }]);
  const adapter = {
    calculations: signal([{ id: 7, name: 'Saved Poseidon', timestamp: 1234 }]),
    loading: signal(false),
    error: signal(''),
    clear: jasmine.createSpy('clear'),
    refresh: jasmine.createSpy('refresh'),
    context: jasmine.createSpy('context'),
    grid: jasmine.createSpy('grid')
  };
  adapter.context.and.callFake(async (id: number) => calculationFixture(id).source);
  adapter.grid.and.callFake(
    async (source: { calculationId: number }) => calculationFixture(source.calculationId).grid
  );
  const persistence = jasmine.createSpyObj('Persistence', ['save', 'load', 'delete']);
  persistence.save.and.resolveTo({});
  persistence.delete.and.resolveTo();
  const reports = jasmine.createSpyObj('Reports', ['list']);
  reports.list.and.resolveTo([]);
  const jobs = jasmine.createSpyObj('Jobs', ['list', 'submit', 'retry']);
  jobs.list.and.resolveTo([]);
  const actions = new Subject<HostLifecycleEvent>();
  const providers = [
    { provide: SimulationJobsClient, useValue: jobs },
    { provide: EcoTwinApiClient, useValue: api },
    { provide: CALCULATIONS, useValue: adapter },
    { provide: SimulationPersistenceClient, useValue: persistence },
    { provide: SimulationReportData, useValue: reports },
    { provide: HOST_LIFECYCLE, useValue: actions },
    { provide: EcoTwinCapabilities, useValue: { execution: signal(true), value: signal({ reporting: true, execution: true }) } }
  ];
  return { api, jobs, adapter, persistence, reports, actions, providers };
}
