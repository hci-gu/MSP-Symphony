#!/usr/bin/env python3
"""Read and verify a real completed local ensemble, plus reject unsafe job submissions.

Does not execute model runs or modify calculations. Requires an existing completed
ensemble and local credentials; authentication material is never printed.
"""
import argparse
import base64
import copy
import http.cookiejar
import json
import math
from pathlib import Path
import struct
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--credentials', type=Path, required=True)
parser.add_argument('--calculation', type=int, default=7)
parser.add_argument('--base', default='http://127.0.0.1:8080/symphony-ws/service')
parser.add_argument('--evidence', type=Path, default=Path('.local/symphony/ensemble-checks.json'))
args = parser.parse_args()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def api(path, body=None, method=None, status=200, anonymous=False):
    request = urllib.request.Request(args.base + path, data=None if body is None else json.dumps(body).encode(),
                                     method=method, headers={'Content-Type': 'application/json'})
    try:
        with (urllib.request.urlopen(request, timeout=120) if anonymous else opener.open(request, timeout=120)) as response:
            assert response.status == status, (path, response.status, status)
            return json.load(response)
    except urllib.error.HTTPError as error:
        assert error.code == status, (path, error.code, status, error.read()[:250])

api('/login', json.loads(args.credentials.read_text()))
cid = args.calculation
jobs = api(f'/calculation/{cid}/simulation-jobs')
job = next(j for j in jobs if j['status'] == 'completed')
run_id = job['runId']
run = api(f'/calculation/{cid}/simulations/{run_id}')
report = api(f'/calculation/{cid}/simulations/{run_id}?view=report')
assert run['version'] == 'ecotwin-run-v2' and report['version'] == 'ecotwin-report-v2'
ensemble = run['ensemble']
assert ensemble == report['ensemble']
assert ensemble['seeds'] == list(range(run['config']['seed'], run['config']['seed'] + 10))
assert len(ensemble['totals']) == 10 and job['completedSeeds'] == 10
assert ensemble['confidenceLevel'] == .95 and ensemble['ciMethod'] == 'student-t'
values = [x[0] for x in struct.iter_unpack('<f', base64.b64decode(run['result']['biomassB64']))]
water = run['input']['water']
count = len(run['result']['species'])
frames = len(run['result']['steps'])
nonzero = 0
for s in range(count):
    for f in range(frames):
        samples = [seed[s][f] for seed in ensemble['totals']]
        mean = sum(samples) / 10
        half = 2.2621571627409915 * math.sqrt(sum((v - mean)**2 for v in samples) / 90)
        assert math.isclose(ensemble['mean'][s][f], mean, rel_tol=1e-12, abs_tol=1e-9)
        assert math.isclose(ensemble['ciLow'][s][f], mean - half, rel_tol=1e-12, abs_tol=1e-9)
        assert math.isclose(ensemble['ciHigh'][s][f], mean + half, rel_tol=1e-12, abs_tol=1e-9)
        mapped = sum(values[(f * len(water) + cell) * count + s] for cell in range(len(water)) if water[cell])
        assert math.isclose(mapped, mean, rel_tol=1e-6, abs_tol=1e-5)
        nonzero += half > 0
assert nonzero > 0, 'The recorded run has no observed seed variation.'
checks = ['ten distinct recorded seeds', '95% Student t intervals independently recomputed',
          'mean maps agree with masked per-seed totals', 'report summary matches saved artifact']
request = {key: run[key] for key in ('version', 'runId', 'input', 'model', 'config')}
path = f'/calculation/{cid}/simulation-jobs/{run_id}'
assert api(path, request, 'PUT') == job
api(path, request, 'PUT', 401, anonymous=True)
bad = copy.deepcopy(request); bad['config']['seed'] += 1
api(path, bad, 'PUT', 409)
for mutation in ('replicates', 'duration', 'domain'):
    bad = copy.deepcopy(request); bad['runId'] = str(uuid.uuid4())
    if mutation == 'replicates': bad['config']['replicates'] = 9
    elif mutation == 'duration': bad['config']['maxSteps'] = 0
    else: bad['input']['waterCells'] += 1
    api(f'/calculation/{cid}/simulation-jobs/{bad["runId"]}', bad, 'PUT', 400)
assert api(f'/calculation/{cid}/simulation-jobs') == jobs
api(f'/calculation/{cid}/simulations/{run_id}', run, 'PUT', 400)
checks += ['idempotent job retry', 'conflicting identity rejected', 'anonymous submission rejected',
           'partial ensemble, invalid duration and forged domain rejected atomically', 'client cannot publish an ensemble']
evidence = {'runId': run_id, 'calculationId': cid, 'seeds': ensemble['seeds'], 'frames': frames,
            'species': count, 'nonzeroConfidenceIntervals': nonzero, 'checks': checks}
args.evidence.parent.mkdir(parents=True, exist_ok=True)
args.evidence.write_text(json.dumps(evidence, indent=2) + '\n')
print(json.dumps(evidence, indent=2))
