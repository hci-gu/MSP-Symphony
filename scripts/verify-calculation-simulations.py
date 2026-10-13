#!/usr/bin/env python3
"""Verify saved-run REST/SQL lifecycle on disposable native calculations.

Requires a local test deployment, the recorded Poseidon fixture with a saved modified
run, and Docker access to its database. Never run against a production instance.
Only calculations created by this invocation are mutated or deleted. Copied output
is used to test the storage contract; it is not a new scientific model result.
"""
import argparse
import copy
import http.cookiejar
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--credentials', type=Path, required=True)
parser.add_argument('--fixture', type=Path, default=Path('data/poseidon/reference-calculation.json'))
parser.add_argument('--base', default='http://127.0.0.1:8080/symphony-ws/service')
parser.add_argument('--db-container', default='msp-symphony-db')
parser.add_argument('--evidence', type=Path, default=Path('.local/symphony/persistence-checks.json'))
args = parser.parse_args()
record = json.loads(args.fixture.read_text())
credentials = json.loads(args.credentials.read_text())
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def api(path, body=None, method=None, status=200, anonymous=False):
    request = urllib.request.Request(args.base + path, data=None if body is None else json.dumps(body).encode(),
                                     method=method, headers={'Content-Type': 'application/json'})
    try:
        with (urllib.request.urlopen(request, timeout=180) if anonymous else opener.open(request, timeout=180)) as response:
            assert response.status == status, (path, response.status, status)
            raw = response.read()
            return json.loads(raw) if raw and 'json' in response.headers.get('Content-Type', '') else raw
    except urllib.error.HTTPError as error:
        assert error.code == status, (path, error.code, status, error.read()[:250])
        return None

def sql(statement):
    return subprocess.run(['docker', 'exec', '-i', args.db_container, 'psql', '-U', 'symphony', '-d', 'symphony',
                           '-v', 'ON_ERROR_STOP=1', '-Atq'], input=statement, text=True, capture_output=True, check=True).stdout.strip()

api('/login', credentials)
source_id = record['modifiedCalculation']['id']
history = api(f'/calculation/{source_id}/simulations')
assert history, 'Run a simulation on the modified Poseidon calculation first.'
template = api(f'/calculation/{source_id}/simulations/{history[-1]["runId"]}')
created = []
run_ids = []
checks = []
try:
    for _ in range(3):
        created.append(api('/calculation/sum', record['scenarioId'])['id'])
    for cid in created:
        manifest = api(f'/calculation/{cid}/inputs')
        grid = api(f'/calculation/{cid}/input-grid', {'fingerprint': manifest['fingerprint'], 'grid': manifest['suggestedGrid'],
            'bands': [{'category': b['category'], 'bandNumber': b['bandNumber']} for b in manifest['bands']]})
        # Require equal effective native inputs before reusing the test tensor/masks.
        assert grid['bands'] == template['input']['nativeGrid']['bands']
        assert grid['domainCoverage'] == template['input']['nativeGrid']['domainCoverage']
        payload = copy.deepcopy(template)
        payload['runId'] = str(uuid.uuid4())
        payload['input']['source'] = manifest
        payload['input']['nativeGrid'] = grid
        payload['input']['name'] = manifest['name']
        path = f'/calculation/{cid}/simulations/{payload["runId"]}'
        saved = api(path, payload, 'PUT')
        assert api(path, payload, 'PUT') == saved
        assert len(api(f'/calculation/{cid}/simulations')) == 1
        assert api(path) == payload
        bad = copy.deepcopy(payload); bad['completedAt'] += 1
        api(path, bad, 'PUT', 409)
        invalid = copy.deepcopy(payload); invalid['runId'] = str(uuid.uuid4())
        invalid['input']['grid']['width'] = 'broken'
        api(f'/calculation/{cid}/simulations/{invalid["runId"]}', invalid, 'PUT', 400)
        assert sql(f"select count(*) from simulation_run where run_id='{invalid['runId']}';") == '0'
        assert sql(f"select count(*) from simulation_artifact where run_id='{invalid['runId']}';") == '0'
        wrong = copy.deepcopy(payload); wrong['runId'] = str(uuid.uuid4())
        wrong['input']['nativeGrid']['bands'][0]['values'][500] = 987
        api(f'/calculation/{cid}/simulations/{wrong["runId"]}', wrong, 'PUT', 400)
        run_ids.append(payload['runId'])
        # Access loss for this disposable object only, restored before cleanup.
        sql(f"update calculationresult set cares_owner='ecotwin-contract-other-owner' where cares_id={cid};")
        try:
            for suffix in ['/inputs', '/simulations', f'/simulations/{payload["runId"]}']:
                api(f'/calculation/{cid}'+suffix, status=403)
            api(path, payload, 'PUT', 403)
        finally:
            # Owner was returned by the actual native calculation; no SQL credential interpolation.
            username = credentials['username'].replace("'", "''")
            sql(f"update calculationresult set cares_owner='{username}' where cares_id={cid};")
        report = api(path+'?view=report')
        sql(f'update calculationresult set cares_geotiff=null where cares_id={cid};')
        assert api(path+'?view=report') == report
        assert api(f'/calculation/{cid}/inputs') == manifest
        assert sql(f'select cares_geotiff is null from calculationresult where cares_id={cid};') == 't'
    checks += ['idempotent retry', 'conflicting identity rejected', 'malformed grid rejected atomically',
               'forged native inputs rejected', 'foreign owner read/write rejected', 'TIFF purge retains appendix and read-only export']
    api(f'/calculation/{created[0]}/simulations', status=401, anonymous=True)
    api(f'/calculation/{created[1]}/simulations/{run_ids[0]}', status=404)
    api(f'/calculation/{created[0]}', method='DELETE')
    api(f'/calculation/{created[0]}/simulations/{run_ids[0]}', template, 'PUT', 404)
    api('/calculation?ids='+','.join(map(str, created[1:])), method='DELETE')
    for run_id in run_ids:
        assert sql(f"select count(*) from simulation_run where run_id='{run_id}';") == '0'
        assert sql(f"select count(*) from simulation_artifact where run_id='{run_id}';") == '0'
    checks += ['anonymous access rejected', 'cross-calculation run reference rejected', 'single and bulk deletion cascade', 'late save cannot resurrect deleted calculation']
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps({'checks': checks, 'disposableCalculationIds': created, 'cleanedUp': True}, indent=2)+'\n')
    print(json.dumps({'passed': len(checks), 'checks': checks}, indent=2))
finally:
    # Even a failing assertion leaves no artificial simulations in the user's reports.
    for cid in created:
        if sql(f'select count(*) from calculationresult where cares_id={cid};') != '0':
            api(f'/calculation/{cid}', method='DELETE')
