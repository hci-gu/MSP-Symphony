import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { EcoTwinCapabilities } from './capabilities';
import { DEFAULT_ECOTWIN_CONFIG } from './config';
describe('EcoTwin installation capabilities', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('shares discovery and distinguishes reporting-only from an absent server', async () => {
    const capabilities = TestBed.inject(EcoTwinCapabilities);
    const first = capabilities.load(),
      second = capabilities.load();
    expect(first).toBe(second);
    TestBed.inject(HttpTestingController)
      .expectOne(`${DEFAULT_ECOTWIN_CONFIG.apiBaseUrl}/extensions/ecotwin/capabilities`)
      .flush({
        installed: true,
        mode: 'reporting-only',
        reporting: true,
        execution: false,
        discovery: false
      });
    expect((await first).reporting).toBeTrue();
    expect(capabilities.execution()).toBeFalse();
    const absent = capabilities.refresh();
    TestBed.inject(HttpTestingController)
      .expectOne(`${DEFAULT_ECOTWIN_CONFIG.apiBaseUrl}/extensions/ecotwin/capabilities`)
      .flush(null, { status: 404, statusText: 'Not Found' });
    expect((await absent).mode).toBe('absent');
    expect(capabilities.value().reporting).toBeFalse();
  });
  it('keeps saved artifacts readable but refuses execution for an unsupported source profile', async () => {
    const capabilities = TestBed.inject(EcoTwinCapabilities);
    const response = capabilities.load();
    TestBed.inject(HttpTestingController)
      .expectOne(`${DEFAULT_ECOTWIN_CONFIG.apiBaseUrl}/extensions/ecotwin/capabilities`)
      .flush({
        installed: true,
        mode: 'enabled',
        reporting: true,
        execution: true,
        discovery: true,
        profile: 'different-source-v2'
      });
    const value = await response;
    expect(value.mode).toBe('reporting-only');
    expect(value.reporting).toBeTrue();
    expect(value.execution).toBeFalse();
    expect(value.discovery).toBeFalse();
    expect(capabilities.message()).toContain('unsupported EcoTwin input profile');
  });
  it('does not confuse forbidden access with an uninstalled plugin', async () => {
    const capabilities = TestBed.inject(EcoTwinCapabilities);
    const response = capabilities.load();
    TestBed.inject(HttpTestingController)
      .expectOne(`${DEFAULT_ECOTWIN_CONFIG.apiBaseUrl}/extensions/ecotwin/capabilities`)
      .flush(null, { status: 403, statusText: 'Forbidden' });
    expect((await response).mode).toBe('unavailable');
    expect(capabilities.value().reporting).toBeFalse();
  });
});
