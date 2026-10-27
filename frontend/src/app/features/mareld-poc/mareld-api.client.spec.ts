import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '@src/environments/environment';
import { MareldApiClient, apiError } from './mareld-api.client';
import { calculationFixture } from './testing/calculation.fixture';
import { runSteps } from './mareld-result';

describe('server-serialized EcoTwin preview contract', () => {
  let client: MareldApiClient, http: HttpTestingController;
  const model = { id: 'demo', name: 'Demo', species: ['codfish'] };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    client = TestBed.inject(MareldApiClient);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('explains unavailable models', async () => {
    const pending = client.models();
    const assertion = expectAsync(pending).toBeRejectedWithError(/compatible policy checkpoints/);
    http.expectOne('/mareld-api/v1/models').flush([]);
    await assertion;
  });
  it('submits frozen native inputs and the chosen preview seed, then decodes the map', async () => {
    const input = calculationFixture().input;
    const pending = client.run(input, model, 40, new AbortController().signal, 77);
    const request = http.expectOne(
      `${environment.apiBaseUrl}/calculation/7/simulation-jobs/preview`
    );
    expect(request.request.method).toBe('POST');
    const body = request.request.body;
    expect(body.version).toBe('ecotwin-preview-v1');
    expect(body.config.seed).toBe(77);
    expect(body.config.replicates).toBe(1);
    expect(body.config.maxSteps).toBe(40);
    expect(body.input.source.calculationId).toBe(7);
    expect(body.input.impacts.layers.length).toBe(2);
    expect(Array.isArray(body.input.water)).toBeTrue();
    request.flush(
      JSON.stringify({
        status: 'completed',
        run_id: body.runId,
        result: {
          dtype: 'float32',
          shape: [11, 60, 60, 1],
          species: model.species,
          steps: runSteps(40),
          biomass_b64: btoa('\0'.repeat(11 * 3600 * 4))
        }
      })
    );
    const result = await pending;
    expect(result.kind).toBe('preview');
    expect(result.seed).toBe(77);
    expect(result.values.length).toBe(11 * 3600);
  });
  it('rejects stale masks and aborted previews before submitting', async () => {
    const input = calculationFixture().input;
    input.impacts!.inputId = 'other';
    await expectAsync(
      client.run(input, model, 4, new AbortController().signal)
    ).toBeRejectedWithError(/different area/);
    input.impacts!.inputId = input.id;
    const controller = new AbortController();
    controller.abort();
    await expectAsync(client.run(input, model, 4, controller.signal)).toBeRejectedWithError(
      /discarded/
    );
    http.expectNone(`${environment.apiBaseUrl}/calculation/7/simulation-jobs/preview`);
  });
  it('does not imply a timed out model has stopped', () => {
    const error = new Error();
    error.name = 'TimeoutError';
    expect(apiError(error)).toContain('may still be computing');
  });

  it('explains the existing server mask-parser limitation without hiding other missing files', () => {
    const error = (message: string) =>
      new HttpErrorResponse({
        status: 400,
        error: JSON.stringify({ error: 'MISSING_FILE', message })
      });
    expect(
      apiError(error('Missing uploaded mask file referenced by request: noise-08.png'))
    ).toContain('Start the model server with the Symphony impact configuration');
    expect(apiError(error('Missing required file field: texture'))).toContain('texture');
  });

  it('offers browser recovery for checkpoint mismatches from text and JSON responses', () => {
    const body = {
      error: 'MODEL_CHECKPOINT_MISMATCH',
      message: "Missing checkpoint(s): ['gadoids', 'porpoises', 'zooplankton']"
    };
    // Runs use responseType: 'text', so HttpClient leaves error JSON as a string.
    for (const error of [JSON.stringify(body), body]) {
      const message = apiError(new HttpErrorResponse({ status: 422, error }));
      expect(message).toContain('Choose another model');
      expect(message).toContain(body.message);
    }
  });
});
