#!/usr/bin/env python3
"""Create Poseidon reference/modified calculations through normal Symphony REST APIs.

Prepare the geometry, audit and baseline-support files first. Output IDs belong to
this deployment. This script never inserts calculation records directly into SQL.
"""
import argparse
import hashlib
import http.cookiejar
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--credentials', type=Path, required=True)
parser.add_argument('--base', default='http://127.0.0.1:8080/symphony-ws/service')
parser.add_argument('--output', type=Path, default=Path('.local/symphony/poseidon-reference.json'))
args = parser.parse_args()
if args.output.exists():
    parser.error('Output already exists; choose a new file to avoid replacing recorded IDs.')
root = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def api(path, body=None, method=None):
    request = urllib.request.Request(args.base+path, data=None if body is None else json.dumps(body).encode(),
                                     method=method, headers={'Content-Type': 'application/json'})
    with opener.open(request, timeout=180) as response:
        raw = response.read()
        return json.loads(raw) if raw and 'json' in response.headers.get('Content-Type', '') else raw

def export(manifest):
    return api(f'/calculation/{manifest["calculationId"]}/input-grid', {
        'fingerprint': manifest['fingerprint'], 'grid': manifest['suggestedGrid'],
        'bands': [{'category': b['category'], 'bandNumber': b['bandNumber']} for b in manifest['bands']]})

api('/login', json.loads(args.credentials.read_text()))
feature = json.loads((root/'data/poseidon/study-area.geojson').read_text())
baseline = next(b for b in api('/baselineversion') if b['name'] == 'HAV_2019_WEST_LOCAL')
area = next((a for a in api('/user/area/all') if a['name'] == 'Poseidon POC review area' and a['polygon'] == feature['geometry']), None)
if area is None:
    area = api('/user/area', {'name': 'Poseidon POC review area', 'description': 'Study square from poseidon.md', 'polygon': feature['geometry']})
scenario = api('/scenario', {'baselineId': baseline['id'], 'name': 'Poseidon — EcoTwin reference', 'changes': {},
    'ecosystemsToInclude': [1,8,10,14,17,20,21,22,31], 'pressuresToInclude': [3,13],
    'normalization': {'type': 'AREA'}, 'operation': 0, 'operationOptions': {},
    'areas': [{'id': -1, 'changes': {}, 'matrix': {'matrixType': 'STANDARD'}, 'feature': feature}]})
reference = api('/calculation/sum', scenario['id'])
report = api(f'/report/{reference["id"]}?lang=en')
hash_before = hashlib.sha256(api(f'/report/{reference["id"]}/geotiff')).hexdigest()
manifest = api(f'/calculation/{reference["id"]}/inputs'); grid = export(manifest)
scenario = api(f'/scenario/{scenario["id"]}')
scenario['changes'] = {'PRESSURE': {'3': {'multiplier': 0.5}}}
api('/scenario', scenario, 'PUT')
modified = api('/calculation/sum', scenario['id'])
modified_manifest = api(f'/calculation/{modified["id"]}/inputs'); modified_grid = export(modified_manifest)
assert api(f'/calculation/{reference["id"]}/inputs') == manifest
assert export(manifest) == grid
assert hashlib.sha256(api(f'/report/{reference["id"]}/geotiff')).hexdigest() == hash_before
assert api(f'/report/{reference["id"]}?lang=en') == report
for number in [3,13]:
    a = next(b for b in grid['bands'] if b['category']=='PRESSURE' and b['bandNumber']==number)['values']
    b = next(b for b in modified_grid['bands'] if b['category']=='PRESSURE' and b['bandNumber']==number)['values']
    if number == 13: assert a == b
    else: assert any(y < x for x,y in zip(a,b) if x is not None) and all(y <= x for x,y in zip(a,b) if x is not None)
record = {'version': 'poseidon-reference-v1', 'geography': 'poseidon.md', 'studyArea': 'data/poseidon/study-area.geojson',
    'parkFootprint': 'data/poseidon/windpark.geojson', 'coverageAudit': 'data/poseidon/coverage-audit.json',
    'baselineId': baseline['id'], 'baselineName': baseline['name'], 'userAreaId': area['id'], 'scenarioId': scenario['id'],
    'calculation': reference, 'modifiedCalculation': modified, 'selectedEcosystems': scenario['ecosystemsToInclude'],
    'selectedPressures': scenario['pressuresToInclude'], 'nativeReport': report, 'nativeGeoTiffSha256': hash_before,
    'inputFingerprint': manifest['fingerprint'], 'modifiedInputFingerprint': modified_manifest['fingerprint'],
    'sourceFingerprints': manifest['sourceFingerprints'], 'savedChanges': manifest['changes'],
    'simulationGrid': grid['grid'], 'inputExportChecks': {'nativeResultUnchanged': True, 'nativeReportUnchanged': True,
    'savedCalculationUnaffectedByScenarioEdit': True, 'recalculationChangesTrawling': True, 'noiseUnaffected': True,
    'nativeDomainKm2': sum(grid['domainCoverage']), 'sourceSupportComplete': all(b['coverage'][i]==1
        for b in grid['bands'] for i,v in enumerate(grid['domainCoverage']) if v>0)}, 'simulationRunIds': []}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n')
print(f'Created reference calculation #{reference["id"]} and modified calculation #{modified["id"]}. Manifest: {args.output}')
