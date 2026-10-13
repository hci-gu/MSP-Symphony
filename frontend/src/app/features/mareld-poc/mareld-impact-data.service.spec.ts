import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MARELD_CATALOG } from '../mareld-layers/mareld-layer-data';
import { MareldImpactData } from './mareld-impact-data.service';

describe('MARELD impact source loading', () => {
  it('loads original source assets, caches successful decodes and retries failed loads', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    const service = TestBed.inject(MareldImpactData);
    const http = TestBed.inject(HttpTestingController);
    const pending = service.load('noise');
    expect(service.load('noise')).toBe(pending);
    const assertion = expectAsync(pending).toBeRejected();
    http
      .expectOne('assets/mareld-layers/noise-125hz-shipping-source.bin')
      .flush(new ArrayBuffer(1));
    await assertion;
    const retry = service.load('noise');
    const cells = MARELD_CATALOG.grid.width * MARELD_CATALOG.grid.height;
    const buffer = new ArrayBuffer(cells * 5);
    new Uint8Array(buffer, cells * 4).fill(1);
    http.expectOne('assets/mareld-layers/noise-125hz-shipping-source.bin').flush(buffer);
    const source = await retry;
    expect(source.raster.values.length).toBe(cells);
    expect(source.grid.cellMetres).toBe(250);
    expect(source.sha256.length).toBe(64);
    expect(service.load('noise')).toBe(retry);
    http.verify();
  });
});
