import { TestBed } from '@angular/core/testing';
import { HostExtensions } from '@src/app/extensions/extensions';
import { APPLICATION_EXTENSION_PROVIDERS } from './absent-providers';
describe('uninstalled distribution legacy metadata', () => {
  it('recognizes old pinned links with no plugin registration', () => {
    TestBed.configureTestingModule({ providers: APPLICATION_EXTENSION_PROVIDERS });
    const extensions = TestBed.inject(HostExtensions);
    expect(extensions.items).toEqual([]);
    expect(extensions.required({ simBase: '7', simBaselineRun: 'a', simScenarioRun: 'b' })).toEqual(
      ['ecotwin']
    );
    expect(extensions.required({ reverse: 'true' })).toEqual([]);
  });
});
