import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MareldApiClient, apiError } from './mareld-api.client';
import { exampleArea, prepareInput } from './mareld-input';

describe('MARELD multipart API contract', () => {
  let client: MareldApiClient;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    client = TestBed.inject(MareldApiClient);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('explains missing checkpoints from the actual empty-list response', async () => {
    const pending = client.models();
    const assertion = expectAsync(pending).toBeRejectedWithError(/compatible policy checkpoints/);
    http.expectOne('/mareld-api/v1/models').flush([]);
    await assertion;
  });

  it('posts a 60 by 60 world for 5,000 steps and decodes all six species and 51 frames', async () => {
    const input = prepareInput(exampleArea(), 'Example');
    const model = {
      id: 'checkpoint',
      name: 'Checkpoint',
      species: [
        'codfish',
        'pelagicFish',
        'porpoises',
        'benthic_community',
        'phytoplankton',
        'zooplankton'
      ]
    };
    // Canvas PNG encoding is asynchronous in real browsers.
    const encoded = new Promise<void>((resolve) => {
      const original = HTMLCanvasElement.prototype.toBlob;
      let count = 0;
      spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (
        this: HTMLCanvasElement,
        callback,
        type
      ) {
        original.call(
          this,
          (blob) => {
            callback(blob);
            if (++count === 2) resolve();
          },
          type
        );
      });
    });
    const pending = client.run(input, model, 5000, new AbortController().signal);
    await encoded;
    await Promise.resolve();
    const request = http.expectOne('/mareld-api/v1/runs');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.has('Content-Type')).toBeFalse(); // Browser supplies multipart boundary.
    const form = request.request.body as FormData;
    const json = JSON.parse(form.get('request') as string);
    expect(json.grid).toEqual({ width: 60, height: 60 });
    expect(json.time).toEqual({
      max_steps: 5000,
      sample_every: 100,
      include_final: true,
      tick_duration_days: 0.25
    });
    expect(json.pressures).toEqual([]);
    expect(json.output.replicates).toBe(1);
    expect(json.seed).toBe(42);
    for (const key of ['texture', 'depth']) {
      const blob = form.get(key) as Blob;
      expect(blob.type).toBe('image/png');
      const bitmap = await createImageBitmap(blob);
      expect(bitmap.width).toBe(input.grid.width);
      expect(bitmap.height).toBe(input.grid.height);
      bitmap.close();
    }
    const count = 51 * input.water.length * model.species.length;
    request.flush(
      JSON.stringify({
        status: 'completed',
        run_id: json.run_id,
        result: {
          dtype: 'float32',
          shape: [51, 60, 60, 6],
          species: model.species,
          steps: Array.from({ length: 51 }, (_, i) => i * 100),
          biomass_b64: btoa('\0'.repeat(count * 4))
        }
      })
    );
    const result = await pending;
    expect(result.source).toBe('live');
    expect(result.values.length).toBe(count);
    expect(result.maxima).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('does not send an already discarded run', async () => {
    const controller = new AbortController();
    controller.abort();
    await expectAsync(
      client.run(
        prepareInput(exampleArea(), 'Example'),
        { id: 'x', name: 'X', species: ['codfish'] },
        1,
        controller.signal
      )
    ).toBeRejectedWithError('Request discarded.');
    http.expectNone('/mareld-api/v1/runs');
  });

  it('does not imply a timed out model has stopped', () => {
    const error = new Error();
    error.name = 'TimeoutError';
    expect(apiError(error)).toContain('may still be computing');
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
