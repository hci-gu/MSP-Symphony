#!/usr/bin/env python3
"""Verify the saved Poseidon comparison through read-only local API requests.

Requires matching completed ensembles on the reference, scenario and its explicitly
saved automatic baseline. Does not create calculations or execute model runs.
"""
import argparse
import http.cookiejar
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--credentials', required=True, type=Path)
parser.add_argument('--reference', type=int, default=7)
parser.add_argument('--scenario', type=int, default=9)
parser.add_argument('--steps', type=int, default=80)
parser.add_argument('--seed', type=int, default=200)
parser.add_argument('--base', default='http://127.0.0.1:8080/symphony-ws/service')
args = parser.parse_args()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
client.open(urllib.request.Request(args.base + '/login', data=args.credentials.read_bytes(),
                                  headers={'Content-Type': 'application/json'})).read()


def api(path):
    with client.open(args.base + path, timeout=120) as response:
        return json.load(response)


link = api(f'/calculation/{args.scenario}/simulation-baseline')
baseline_id = link['baselineCalculationId']
assert link['scenarioCalculationId'] == args.scenario
runs = {}
for cid in [args.reference, args.scenario, baseline_id]:
    runs[cid] = next(run for run in api(f'/calculation/{cid}/simulations')
                     if run.get('ensemble') and run['config']['maxSteps'] == args.steps
                     and run['config']['seed'] == args.seed)
    assert runs[cid]['ensemble']['seeds'] == list(range(args.seed, args.seed + 10))
reference, scenario, baseline = [runs[cid] for cid in [args.reference, args.scenario, baseline_id]]
for run in [scenario, baseline]:
    for key in ['config', 'grid', 'water', 'species', 'steps', 'nativeAreaKm2']:
        assert reference[key] == run[key], key
    assert reference['source']['sourceFingerprints'] == run['source']['sourceFingerprints']
assert reference['ensemble'] == baseline['ensemble'], 'Saved implicit baseline must reproduce the reference'
assert reference['ensemble'] != scenario['ensemble'], 'Poseidon pressure scenario must have different results'
implicit = api(f'/report/comparison/{args.scenario}')
explicit = api(f'/report/comparison/{baseline_id}/{args.scenario}')
assert implicit['b'] == explicit['b']
for key, value in implicit['a'].items():
    if key not in ['name', 'scenarioChanges', 'timestamp']:
        assert value == explicit['a'][key], key
for key in ['chartDataPositive', 'chartDataNegative']:
    assert implicit[key] == explicit[key], key
print(json.dumps({'verified': True, 'baselineCalculationId': baseline_id,
                  'runs': {cid: run['runId'] for cid, run in runs.items()},
                  'nativeStatisticsMatch': True, 'baselineEnsemblesIdentical': True}, indent=2))
