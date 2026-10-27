"""Artificial model protocol fixtures; never ecological reference output."""
import base64
import copy
import math
import struct
import time
import uuid

MODEL = {'id': 'acceptance-synthetic', 'name': 'Synthetic protocol fixture', 'species': ['synthetic-fish', 'synthetic-algae']}


def prepared_request(api, calculation, seed=100):
    source = api.request(f'/calculation/{calculation}/inputs')
    grid = api.request(f'/calculation/{calculation}/input-grid', dict(fingerprint=source['fingerprint'],
        grid=source['suggestedGrid'], bands=[dict(category=b['category'], bandNumber=b['bandNumber']) for b in source['bands']]), 'POST')
    water = [int(value > 0) for value in grid['domainCoverage']]
    identity = str(uuid.uuid4())
    layers = []
    for band in grid['bands']:
        if band['category'] != 'PRESSURE':
            continue
        kind = 'trawling' if band['bandNumber'] == 3 else 'noise'
        levels = [max(1, min(16, math.floor(value / 100 * 16 + .5))) if wet and value > 0 else 0
                  for value, wet in zip(band['values'], water)]
        intensity = lambda level: 0 if not level else (60 + 60 * level / 16 if kind == 'noise' else .2 * level / 16)
        float32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
        layers.append(dict(kind=kind, sourceId='synthetic-' + kind, sourceFile='Synthetic protocol fixture',
            sourceSha256=band['sourceSha256'], sourceGrid=grid['grid'], strength=1, coverage=1,
            affectedCells=sum(bool(level) for level in levels), values=[float32(intensity(level)) for level in levels],
            bands=[dict(id=f'{kind}-{level:02}', level=level, intensity=intensity(level), mask=[int(value == level) for value in levels])
                   for level in sorted(set(levels) - {0})]))
    return dict(version='ecotwin-run-v2', runId=str(uuid.uuid4()), model=copy.deepcopy(MODEL),
        config=dict(maxSteps=8, sampleEvery=4, seed=seed, replicates=10, tickDurationDays=.25, mappingVersion='hav-west-native-v1'),
        input=dict(id=identity, name='Synthetic protocol fixture',
            geometry=dict(type='Feature', properties={'name': 'Synthetic protocol fixture'}, geometry=source['geometry']),
            grid=grid['grid'], water=water, waterCells=sum(water), source=source, nativeGrid=grid,
            assumptions=['Artificial protocol fixture. Declared reviewed source identities do not imply scientific provenance.'],
            impacts=dict(id=str(uuid.uuid4()), inputId=identity, version='hav-west-native-v1',
                settings={kind: dict(enabled=True, strength=1) for kind in ['noise', 'trawling']}, layers=layers)))


def legacy_result(request, preview):
    saved = copy.deepcopy(request)
    saved['version'] = 'ecotwin-run-v1'
    saved['runId'] = str(uuid.uuid4())
    saved['config']['seed'] = 42
    saved['config'].pop('replicates')
    saved['completedAt'] = int(time.time() * 1000)
    result = preview['result']
    saved['result'] = dict(steps=result['steps'], species=result['species'], units='tonnes/cell',
                           order='frame,row,column,species', biomassB64=result['biomass_b64'])
    return saved


def verify_ensemble(saved):
    ensemble = saved['ensemble']
    assert ensemble['seeds'] == list(range(saved['config']['seed'], saved['config']['seed'] + 10))
    assert ensemble['ciMethod'] == 'student-t' and ensemble['confidenceLevel'] == .95
    values = [item[0] for item in struct.iter_unpack('<f', base64.b64decode(saved['result']['biomassB64']))]
    water, species, frames = saved['input']['water'], len(saved['result']['species']), len(saved['result']['steps'])
    for s in range(species):
        for f in range(frames):
            samples = [seed[s][f] for seed in ensemble['totals']]
            mean = sum(samples) / 10
            half = 2.2621571627409915 * math.sqrt(sum((value - mean) ** 2 for value in samples) / 90)
            assert math.isclose(ensemble['mean'][s][f], mean, abs_tol=1e-9)
            assert math.isclose(ensemble['ciLow'][s][f], mean - half, abs_tol=1e-9)
            assert math.isclose(ensemble['ciHigh'][s][f], mean + half, abs_tol=1e-9)
            mapped = sum(values[(f * len(water) + cell) * species + s] for cell, wet in enumerate(water) if wet)
            assert math.isclose(mapped, mean, rel_tol=1e-6, abs_tol=1e-5)
