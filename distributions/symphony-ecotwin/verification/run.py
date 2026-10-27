#!/usr/bin/env python3
"""Boot disposable Symphony distributions against real WildFly and PostGIS.

Only uniquely named acceptance containers/network and a newly created output
folder are touched. Existing Docker containers, volumes and local app data are
never read or mounted. The base WAR copy enables Hibernate DDL solely to create
an empty test schema; the enabled WAR is deployed unmodified after SQL migrations.
"""
import argparse
import copy
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from protocol import prepared_request, legacy_result, verify_ensemble
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PASSWORD = 'disposable-acceptance-only'
DEFAULT_WILDFLY = 'quay.io/wildfly/wildfly:36.0.1.Final-jdk17'
DEFAULT_DATABASE = 'ghcr.io/baosystems/postgis:14-3.4'


def command(args, *, input=None, check=True):
    result = subprocess.run(args, input=input, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed: {result.stderr[-3000:]}{result.stdout[-3000:]}')
    return result


class Api:
    def __init__(self, base):
        self.base = base
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, body=None, method=None, status=200):
        req = urllib.request.Request(self.base + path,
            data=None if body is None else json.dumps(body).encode(), method=method,
            headers={'Content-Type': 'application/json'})
        try:
            response = self.client.open(req, timeout=180)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            expected = status if isinstance(status, tuple) else (status,)
            assert response.status in expected, (path, response.status, status, raw[:1000].decode(errors='replace'))
            self.last_status = response.status
            return json.loads(raw) if raw and 'json' in response.headers.get('Content-Type', '') else raw

    def login(self, username='acceptance'):
        self.request('/login', dict(username=username, password=PASSWORD), status=200)


def archive_assertions(base, enabled):
    def entries(path):
        with zipfile.ZipFile(path) as archive:
            return archive.namelist()
    is_plugin = lambda name: '/org/ecotwin/' in name or 'ecotwin' in Path(name).name.lower()
    absent = [p for p in entries(base) if is_plugin(p)]
    assert not absent, f'Base WAR contains plugin artifacts: {absent[:10]}'
    assert any(is_plugin(p) for p in entries(enabled)), 'Enabled WAR contains no plugin artifacts'


def bootstrap_copy(source, target):
    """Only this disposable base bootstrap copy permits automatic DDL."""
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as output:
        for entry in original.infolist():
            content = original.read(entry.filename)
            if entry.filename == 'WEB-INF/classes/META-INF/persistence.xml':
                content = content.replace(b'<properties>', b'<properties>\n<property name="hibernate.hbm2ddl.auto" value="update"/>')
            if entry.filename == 'WEB-INF/classes/symphony-global.properties':
                content += b'\nareas.countrycode=SWE\ndata.cache_dir=/tmp/symphony-cache\ncalc.jai.tilecache.capacity=64\n'
            output.writestr(entry, content)


class Acceptance:
    def __init__(self, args):
        self.args = args
        self.prefix = 'ecotwin-acceptance-' + uuid.uuid4().hex[:10]
        self.network, self.database = self.prefix + '-network', self.prefix + '-db'
        self.containers = []
        self.output = args.output.resolve() if args.output else ROOT / '.local' / self.prefix
        self.output.mkdir(parents=True, exist_ok=False)
        self.output.chmod(0o755)
        self.evidence = dict(status='running', resources=dict(network=self.network, database=self.database), checks=[])

    def record(self, name):
        self.evidence['checks'].append(name)
        print('PASS ' + name, flush=True)
        self.save()

    def save(self):
        (self.output / 'evidence.json').write_text(json.dumps(self.evidence, indent=2) + '\n')

    def sql(self, statement):
        return command(['docker', 'exec', '-i', self.database, 'psql', '-U', 'acceptance', '-d', 'symphony',
                        '-v', 'ON_ERROR_STOP=1', '-Atq'], input='SET search_path=symphony,public;\n' + statement).stdout.strip()

    def wait_sql(self, statement, predicate, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = self.sql(statement)
            if predicate(value):
                return value
            time.sleep(.2)
        raise AssertionError(('Database barrier did not reach expected state', statement, value))

    @contextmanager
    def database_barrier(self, statement):
        """Hold a real database lock until HTTP transactions are demonstrably blocked."""
        identity = 'acceptance-barrier-' + uuid.uuid4().hex
        log = (self.output / (identity + '.log')).open('w')
        process = subprocess.Popen(['docker', 'exec', '-i', self.database, 'psql', '-U', 'acceptance',
            '-d', 'symphony', '-v', 'ON_ERROR_STOP=1', '-Atq'], stdin=subprocess.PIPE, stdout=log,
            stderr=subprocess.STDOUT, text=True)
        try:
            process.stdin.write(f"SET application_name='{identity}'; SET search_path=symphony,public; BEGIN; {statement};\n")
            process.stdin.flush()
            pid = self.wait_sql(f"SELECT pid FROM pg_stat_activity WHERE application_name='{identity}' AND state='idle in transaction'", bool)
            yield int(pid)
        finally:
            if process.poll() is None:
                process.stdin.write('ROLLBACK;\n\\q\n')
                process.stdin.flush()
                process.communicate(timeout=10)
            log.close()
            assert process.returncode == 0, 'Database barrier failed; inspect its isolated log'

    def wait_blocked(self, blocker, count=1):
        return self.wait_sql(f"SELECT count(*) FROM pg_stat_activity WHERE {blocker}=ANY(pg_blocking_pids(pid))",
                             lambda value: int(value) >= count)

    @contextmanager
    def trigger(self, name, table, event, body):
        """Faults/barriers exist only in this disposable acceptance database."""
        self.sql(f"CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN {body} RETURN NEW; END;$$; "
                 f"CREATE TRIGGER {name} BEFORE {event} ON {table} FOR EACH ROW EXECUTE FUNCTION {name}();")
        try:
            yield
        finally:
            self.sql(f'DROP TRIGGER {name} ON {table}; DROP FUNCTION {name}();')

    def plugin_digests(self):
        return {table: self.sql(f"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY {key})::text, '[]')) FROM {table} t")
                for table, key in [('simulation_run', 'run_id'), ('simulation_artifact', 'run_id'),
                                   ('simulation_job', 'run_id'), ('simulation_baseline', 'scenario_calculation_id')]}

    def start_database(self):
        command(['docker', 'network', 'create', '--label', 'org.ecotwin.acceptance=true', self.network])
        command(['docker', 'run', '-d', '--name', self.database, '--network', self.network,
                 '--network-alias', 'database', '--label', 'org.ecotwin.acceptance=true',
                 '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_DB=symphony',
                 '-e', 'POSTGRES_USER=acceptance', '-e', 'POSTGRES_PASSWORD=' + PASSWORD, self.args.database_image])
        self.containers.append(self.database)
        for _ in range(90):
            if command(['docker', 'exec', self.database, 'pg_isready', '-h', '127.0.0.1', '-U', 'acceptance', '-d', 'symphony'], check=False).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Disposable database did not become ready')
        self.sql('CREATE SCHEMA symphony AUTHORIZATION acceptance; CREATE EXTENSION IF NOT EXISTS postgis;')

    def start_app(self, stage, war, bootstrap=False, execution=False):
        folder = self.output / stage
        folder.mkdir()
        folder.chmod(0o755)
        if bootstrap:
            bootstrap_copy(war, folder / 'deployment.war')
        else:
            shutil.copyfile(war, folder / 'deployment.war')
        for filename in ['configure.cli', 'start-wildfly.sh']:
            shutil.copyfile(HERE / filename, folder / filename)
        shutil.copyfile(self.args.jdbc_jar, folder / 'postgresql.jar')
        (folder / 'symphony-global.properties').write_text('areas.countrycode=SWE\ndata.cache_dir=/tmp/symphony-cache\ncalc.jai.tilecache.capacity=64\n')
        shutil.copytree(self.output / 'fixtures', folder / 'fixtures',
            ignore=(shutil.ignore_patterns('*-support.tif', 'calculation-*', '*.json', '*.sql') if bootstrap else None))
        name = self.prefix + '-' + stage
        command(['docker', 'run', '-d', '--name', name, '--network', self.network,
                 '--label', 'org.ecotwin.acceptance=true', '-p', '127.0.0.1::8080',
                 '-e', 'JAVA_OPTS=-Xms128m -Xmx1024m -Djava.net.preferIPv4Stack=true',
                 '-e', 'ECOTWIN_EXECUTION_ENABLED=' + str(execution).lower(),
                 '-e', 'ECOTWIN_API_URL=' + ('http://model:8000' if execution else ''),
                 '--mount', f'type=bind,src={folder},dst=/verification,readonly',
                 '--mount', f'type=bind,src={folder / "symphony-global.properties"},dst=/app/config/symphony/symphony-global.properties,readonly',
                 self.args.wildfly_image, 'bash', '/verification/start-wildfly.sh'])
        self.containers.append(name)
        address = command(['docker', 'port', name, '8080/tcp']).stdout.strip()
        base = 'http://' + address + '/symphony-ws/service'
        self.evidence.setdefault('servers', {})[stage] = dict(container=name, base=base)
        self.save()
        for _ in range(180):
            try:
                Api(base).request('/getuser', status=401)
                break
            except Exception:
                if command(['docker', 'inspect', '-f', '{{.State.Running}}', name]).stdout.strip() != 'true':
                    self.logs(name, stage)
                    raise RuntimeError(f'{stage} WildFly exited; see {self.output / (stage + ".log")}')
                time.sleep(1)
        else:
            self.logs(name, stage)
            raise RuntimeError(f'{stage} did not deploy; see {self.output / (stage + ".log")}')
        self.logs(name, stage)
        return Api(base), name

    def logs(self, name, stage):
        result = command(['docker', 'logs', name], check=False)
        path = self.output / (stage + '.log')
        if result.returncode == 0 or not path.exists():
            path.write_text(result.stdout + result.stderr)

    def stop_app(self, name, stage):
        self.logs(name, stage)
        command(['docker', 'rm', '-f', name])
        self.containers.remove(name)

    def restart_app(self, api, name, stage):
        command(['docker', 'restart', name])
        # Docker may choose a new host port for an ephemeral publication on restart.
        address = command(['docker', 'port', name, '8080/tcp']).stdout.strip()
        api.base = 'http://' + address + '/symphony-ws/service'
        self.evidence['servers'][stage]['base'] = api.base
        self.save()
        for _ in range(180):
            try:
                Api(api.base).request('/getuser', status=401)
                api.login()
                self.logs(name, stage)
                return
            except Exception:
                if command(['docker', 'inspect', '-f', '{{.State.Running}}', name]).stdout.strip() != 'true':
                    self.logs(name, stage)
                    raise RuntimeError(f'{stage} retained container could not restart')
                time.sleep(1)
        raise RuntimeError(f'{stage} retained container did not redeploy')

    def native(self, api, label):
        api.login()
        assert api.request('/getuser')['username'] == 'acceptance'
        api.request('/user/settings', {'acceptanceMarker': label}, 'PUT')
        assert api.request('/getuser')['settings']['acceptanceMarker'] == label
        baselines = api.request('/baselineversion')
        assert len(baselines) == 1
        assert api.request('/areas') == ['ACCEPTANCE']
        assert len(api.request('/areas/boundary')['areas']) == 1
        assert api.request('/areas/ACCEPTANCE')['groups'][0]['areas']
        assert isinstance(api.request('/calculation/multi-comparison/all'), list)
        metadata = api.request('/metadata/' + baselines[0]['name'] + '?lang=en')
        assert metadata['ecoComponent']['symphonyThemes'] and metadata['pressureComponent']['symphonyThemes']
        feature = json.loads((self.output / 'fixtures/feature.json').read_text())
        area = api.request('/user/area', dict(name='Acceptance ' + label, description='Disposable synthetic fixture',
                                            polygon=feature['geometry']), 'POST', 201)
        assert area['id'] > 0
        scenario = api.request('/scenario', dict(baselineId=baselines[0]['id'], name='Acceptance ' + label,
            changes={}, ecosystemsToInclude=[0], pressuresToInclude=[3, 13], normalization={'type': 'AREA'},
            operation=0, operationOptions={}, areas=[dict(id=-1, changes={}, matrix={'matrixType': 'STANDARD'}, feature=feature)]),
            'POST', 201)
        calculation = api.request('/calculation/sum', scenario['id'], 'POST')
        cid = calculation['id']
        report = api.request(f'/report/{cid}?lang=en')
        assert report
        tiff = api.request(f'/report/{cid}/geotiff')
        assert tiff[:2] in (b'II', b'MM'), 'Native GeoTIFF missing'
        csv = api.request(f'/report/{cid}/csv?lang=en')
        assert csv, 'Native CSV missing'
        image = api.request(f'/calculation/{cid}/image')
        assert image.startswith(b'\x89PNG'), 'Native map image missing'
        assert any(row['id'] == cid for row in api.request('/calculation/all'))
        # Recalculate through the native flow to exercise an explicit comparison.
        scenario = api.request(f'/scenario/{scenario["id"]}')
        scenario['changes'] = {'PRESSURE': {'3': {'multiplier': 0.5}}}
        api.request('/scenario', scenario, 'PUT')
        modified = api.request('/calculation/sum', scenario['id'], 'POST')['id']
        assert api.request(f'/report/comparison/{cid}/{modified}?lang=en')
        assert api.request(f'/report/comparison/{modified}?lang=en')
        assert hashlib.sha256(api.request(f'/report/{cid}/geotiff')).hexdigest() == hashlib.sha256(tiff).hexdigest()
        self.record(f'{label}: login/session, native UI catalogue/metadata/comparison history, settings transaction, area/scenario, calculation/image/CSV/GeoTIFF, explicit/implied comparison')
        return dict(calculation=cid, modified=modified, scenario=scenario['id'], area=area['id'],
                    nativeTiffSha256=hashlib.sha256(tiff).hexdigest())

    def absent(self, api):
        api.login()
        for path in ['/extensions/ecotwin/capabilities', '/calculation/1/inputs',
                     '/calculation/1/simulations', '/calculation/1/simulation-jobs', '/calculation/1/simulation-baseline']:
            api.request(path, status=404)
        assert self.sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='symphony' AND table_name LIKE 'simulation_%'") == '0'
        self.record('base: plugin classes, HTTP routes and simulation tables absent')

    def enabled(self, api, fixture):
        api.login()
        caps = api.request('/extensions/ecotwin/capabilities')
        assert caps['installed'] is True and caps['reporting'] is True and caps['execution'] is False, caps
        cid = fixture['modified']
        prefix = f'/calculation/{cid}'
        assert api.request(prefix + '/simulations') == []
        assert api.request(prefix + '/simulation-jobs') == []
        Api(api.base).request(prefix + '/simulations', status=401)
        stranger = Api(api.base)
        stranger.login('stranger')
        stranger.request(prefix + '/simulations', status=403)
        source = api.request(prefix + '/inputs')
        assert source['available'] is True, source
        grid = api.request(prefix + '/input-grid', dict(fingerprint=source['fingerprint'], grid=source['suggestedGrid'],
            bands=[dict(category=b['category'], bandNumber=b['bandNumber']) for b in source['bands']]), 'POST')
        assert any(grid['domainCoverage'])
        api.request(prefix + '/input-grid', dict(fingerprint='0' * 64, grid=source['suggestedGrid'], bands=[dict(category=b['category'], bandNumber=b['bandNumber']) for b in source['bands']]), 'POST', 409)
        api.request(prefix + '/simulation-baseline', status=204)
        before = self.sql('SELECT (SELECT count(*) FROM calculationresult), (SELECT count(*) FROM scenariosnapshot), (SELECT count(*) FROM simulation_baseline)')
        with self.trigger('acceptance_fail_baseline', 'simulation_baseline', 'INSERT',
                          "RAISE EXCEPTION 'Deliberate acceptance baseline link failure';"):
            api.request(prefix + '/simulation-baseline', method='POST', status=500)
        assert self.sql('SELECT (SELECT count(*) FROM calculationresult), (SELECT count(*) FROM scenariosnapshot), (SELECT count(*) FROM simulation_baseline)') == before
        assert api.request(f'/scenario/{fixture["scenario"]}')['latestCalculationId'] == cid
        api.request(prefix + '/simulation-baseline', status=204)
        self.record('transactions: failed baseline-link insert rolls back native calculation/snapshot/link without changing scenario pointer')
        link = api.request(prefix + '/simulation-baseline', method='POST')
        assert link == api.request(prefix + '/simulation-baseline', method='POST')
        assert link['scenarioCalculationId'] == cid and link['baselineCalculationId'] != cid
        assert api.request(f'/scenario/{fixture["scenario"]}')['latestCalculationId'] == cid
        bid = link['baselineCalculationId']
        assert api.request(f'/report/{bid}?lang=en')
        stranger.request(prefix + '/simulation-baseline', method='POST', status=403)
        # Failure has a real HTTP/transaction boundary and must not leave a job row.
        api.request(prefix + '/simulation-jobs/' + str(uuid.uuid4()), {}, 'PUT', 503)
        assert api.request(prefix + '/simulation-jobs') == []
        api.request(prefix + '/simulations/' + str(uuid.uuid4()), {}, 'PUT', 400)
        assert api.request(prefix + '/simulations') == []
        assert hashlib.sha256(api.request(f'/report/{fixture["calculation"]}/geotiff')).hexdigest() == fixture['nativeTiffSha256']
        self.record('enabled: JAX-RS/EJB/JPA discovery, reporting-only capabilities, auth/ownership, native input export, conflict rejection')
        self.record('enabled: native baseline creation/idempotency preserves scenario pointer and source raster; rejected writes leave no jobs/runs')
        # Delete native calculation through its real endpoint; the link must cascade,
        # while the independently saved baseline calculation remains available.
        api.request(prefix, method='DELETE', status=200)
        assert self.sql(f'SELECT count(*) FROM simulation_baseline WHERE scenario_calculation_id={cid}') == '0'
        assert api.request(f'/report/{bid}?lang=en')
        self.record('enabled: native calculation deletion clears latest pointer and cascades plugin link without deleting independent baseline')
        self.evidence['plugin'] = dict(capabilities=caps, baselineCalculation=bid)

    def start_model(self):
        name = self.prefix + '-model'
        command(['docker', 'run', '-d', '--name', name, '--network', self.network,
                 '--network-alias', 'model', '--label', 'org.ecotwin.acceptance=true',
                 '-p', '127.0.0.1::8000', '--mount', f'type=bind,src={HERE / "model-stub.cjs"},dst=/model.cjs,readonly',
                 'node:22-bookworm-slim', 'node', '/model.cjs'])
        self.containers.append(name)
        self.evidence['resources']['model'] = name
        address = command(['docker', 'port', name, '8000/tcp']).stdout.strip()
        self.model_api = Api('http://' + address)
        for _ in range(30):
            try:
                self.model_api.request('/v1/models')
                return name
            except Exception:
                time.sleep(1)
        raise RuntimeError('Synthetic model stub did not start')

    def wait_job(self, api, cid, run_id, predicate, timeout=150):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = next(j for j in api.request(f'/calculation/{cid}/simulation-jobs') if j['runId'] == run_id)
            if predicate(job):
                return job
            if job['status'] == 'failed':
                raise AssertionError(job)
            time.sleep(1)
        raise RuntimeError(f'Synthetic job {run_id} did not reach expected state')

    def concurrent_submit(self, api, cid, request):
        clients = [Api(api.base), Api(api.base)]
        for client in clients:
            client.login()
        url = f'/calculation/{cid}/simulation-jobs/{request["runId"]}'
        with ThreadPoolExecutor(max_workers=2) as pool:
            with self.database_barrier(f'SELECT cares_id FROM calculationresult WHERE cares_id={cid} FOR UPDATE') as blocker:
                results = [pool.submit(client.request, url, request, 'PUT') for client in clients]
                # Both requests have entered real JTA transactions, before either can insert.
                self.wait_sql("SELECT count(*) FROM pg_stat_activity WHERE datname='symphony' AND wait_event_type='Lock'", lambda value: int(value) >= 2)
            assert all(result.result()['runId'] == request['runId'] for result in results)
        assert self.sql(f"SELECT count(*) FROM simulation_job WHERE run_id='{request['runId']}'") == '1'
        changed = copy.deepcopy(request)
        changed['runId'] = str(uuid.uuid4())
        api.request(f'/calculation/{cid}/simulation-jobs/{changed["runId"]}', changed, 'PUT', 409)
        self.record('concurrency: simultaneous identical submissions create one durable job; another active run conflicts')

    def rollback_upgrade(self, api, app_name, fixture, legacy_url, legacy, saved_url, saved, failed_id, failed):
        """Code rollback keeps the additive schema and all data; no destructive downgrade."""
        cid = fixture['calculation']
        baseline = api.request(f'/calculation/{cid}/simulation-baseline', method='POST')
        before = self.plugin_digests()
        self.stop_app(app_name, 'resumed')
        base, name = self.start_app('rollback-base', self.args.base_war)
        base.login()
        base.request('/extensions/ecotwin/capabilities', status=404)
        base.request(saved_url, status=404)
        assert base.request(f'/report/{cid}?lang=en')
        assert base.request(f'/report/{baseline["baselineCalculationId"]}?lang=en')
        assert hashlib.sha256(base.request(f'/report/{cid}/geotiff')).hexdigest() == fixture['nativeTiffSha256']
        assert any(row['id'] == cid for row in base.request('/calculation/all'))
        assert before == self.plugin_digests()
        self.stop_app(name, 'rollback-base')
        for migration in ['SimulationRuns.sql', 'SimulationJobs.sql', 'SimulationBaselines.sql']:
            self.sql((ROOT / 'plugins/ecotwin/migrations' / migration).read_text())
        restored, name = self.start_app('upgrade-reporting', self.args.enabled_war)
        restored.login()
        assert restored.request(legacy_url) == legacy
        assert restored.request(saved_url) == saved
        assert restored.request(f'/calculation/{cid}/simulation-baseline') == baseline
        assert next(job for job in restored.request(f'/calculation/{cid}/simulation-jobs') if job['runId'] == failed_id) == failed
        restored.request(f'/calculation/{cid}/simulation-jobs/{failed_id}/retry', {}, 'POST', 503)
        assert before == self.plugin_digests()
        self.stop_app(name, 'upgrade-reporting')
        self.record('compatibility: base-code rollback, idempotent migration replay and enabled upgrade preserve exact v1/v2/completed/failed-checkpoint/baseline data')
        self.evidence['compatibility'] = dict(pluginTableDigests=before, baseline=baseline,
            scope='Same built distribution pair; additive schema retained. Historical enabled binaries and destructive schema downgrade are not tested.')

    def finalize_delete_race(self, api, cid):
        """Make finalization acquire the calculation lock before native BMT deletion."""
        request = prepared_request(api, cid, seed=300)
        run_id = request['runId']
        gate = 7246130
        deleter = Api(api.base)
        deleter.login()
        with self.trigger('acceptance_gate_artifact', 'simulation_artifact', 'INSERT',
                          f"IF NEW.run_id='{run_id}' THEN PERFORM pg_advisory_xact_lock({gate}); END IF;"):
            with ThreadPoolExecutor(max_workers=1) as pool:
                with self.database_barrier(f'SELECT pg_advisory_xact_lock({gate})') as blocker:
                    api.request(f'/calculation/{cid}/simulation-jobs/{run_id}', request, 'PUT')
                    self.wait_sql(f"SELECT count(*) FROM pg_stat_activity WHERE {blocker}=ANY(pg_blocking_pids(pid))", lambda value: int(value) == 1, timeout=150)
                    worker = self.sql(f'SELECT pid FROM pg_stat_activity WHERE {blocker}=ANY(pg_blocking_pids(pid))')
                    assert self.sql(f"SELECT completed_seeds FROM simulation_job WHERE run_id='{run_id}'") == '10'
                    assert self.sql(f"SELECT count(*) FROM simulation_run WHERE run_id='{run_id}'") == '0'
                    delete = pool.submit(deleter.request, f'/calculation/{cid}', None, 'DELETE', 200)
                    self.wait_blocked(int(worker))
                delete.result()
        assert self.sql(f'SELECT count(*) FROM calculationresult WHERE cares_id={cid}') == '0'
        for table in ['simulation_job', 'simulation_run', 'simulation_artifact']:
            assert self.sql(f"SELECT count(*) FROM {table} WHERE run_id='{run_id}'") == '0'
        self.record('concurrency: native BMT deletion waits for CMT finalization, then cascades its committed job/run/artifact without deadlock')

    def submit_delete_race(self, api, cid):
        """Make native deletion own the row before a new submission requests its lock."""
        request = prepared_request(api, cid, seed=400)
        submitter, deleter = Api(api.base), Api(api.base)
        submitter.login()
        deleter.login()
        gate = 7246131
        with self.trigger('acceptance_gate_delete', 'calculationresult', 'DELETE',
                          f'IF OLD.cares_id={cid} THEN PERFORM pg_advisory_xact_lock({gate}); END IF; RETURN OLD;'):
            with ThreadPoolExecutor(max_workers=2) as pool:
                with self.database_barrier(f'SELECT pg_advisory_xact_lock({gate})') as blocker:
                    delete = pool.submit(deleter.request, f'/calculation/{cid}', None, 'DELETE', 200)
                    self.wait_blocked(blocker)
                    deleting = self.sql(f'SELECT pid FROM pg_stat_activity WHERE {blocker}=ANY(pg_blocking_pids(pid))')
                    submit = pool.submit(submitter.request, f'/calculation/{cid}/simulation-jobs/{request["runId"]}', request, 'PUT', (404, 409))
                    self.wait_blocked(int(deleting))
                delete.result()
                submit.result()
        assert self.sql(f'SELECT count(*) FROM calculationresult WHERE cares_id={cid}') == '0'
        assert self.sql(f"SELECT count(*) FROM simulation_job WHERE run_id='{request['runId']}'") == '0'
        self.record('concurrency: deletion winning against submission rejects attachment and leaves no late job')

    def execution(self, fixture, secondary):
        model_name = self.start_model()
        api, name = self.start_app('execution', self.args.enabled_war, execution=True)
        api.login()
        caps = api.request('/extensions/ecotwin/capabilities')
        assert caps['execution'] is True and caps['discovery'] is True
        models = api.request('/extensions/ecotwin/models')
        assert models[0]['id'] == 'acceptance-synthetic'
        cid = fixture['calculation']
        path = f'/calculation/{cid}'
        request = prepared_request(api, cid)
        preview_request = copy.deepcopy(request)
        preview_request['version'] = 'ecotwin-preview-v1'
        preview_request['runId'] = str(uuid.uuid4())
        preview_request['config']['replicates'] = 1
        preview_request['config']['seed'] = 42
        preview = api.request(path + '/simulation-jobs/preview', preview_request, 'POST')
        assert preview['status'] == 'completed'
        assert api.request(path + '/simulations') == []
        assert api.request(path + '/simulation-jobs') == []
        legacy = legacy_result(request, preview)
        legacy_url = path + '/simulations/' + legacy['runId']
        summary = api.request(legacy_url, legacy, 'PUT')
        assert api.request(legacy_url, legacy, 'PUT') == summary
        assert api.request(legacy_url)['result'] == legacy['result']
        invalid = copy.deepcopy(legacy)
        invalid['completedAt'] += 1
        api.request(legacy_url, invalid, 'PUT', 409)
        self.record('execution: backend discovery, unsaved preview and v1 artifact idempotency/conflict')
        run_id = request['runId']
        url = path + '/simulation-jobs/' + run_id
        self.concurrent_submit(api, cid, request)
        assert api.request(url, request, 'PUT')['runId'] == run_id
        changed = copy.deepcopy(request)
        changed['config']['seed'] += 1
        api.request(url, changed, 'PUT', 409)
        checkpoint = self.wait_job(api, cid, run_id, lambda job: job['completedSeeds'] >= 2)
        self.stop_app(name, 'execution')
        api, name = self.start_app('resumed', self.args.enabled_war, execution=True)
        api.login()
        failed = self.wait_job(api, cid, run_id, lambda job: job['status'] == 'failed')
        assert failed['completedSeeds'] == 3 and failed['completedSeeds'] >= checkpoint['completedSeeds']
        api.request(url + '/retry', {}, 'POST')
        completed = self.wait_job(api, cid, run_id, lambda job: job['status'] == 'completed')
        assert completed['completedSeeds'] == 10
        saved_url = path + '/simulations/' + run_id
        saved = api.request(saved_url)
        verify_ensemble(saved)
        assert api.request(saved_url + '?view=report')['ensemble'] == saved['ensemble']
        api.request(saved_url, saved, 'PUT', 400)
        records = self.model_api.request('/acceptance/status')['submitted']
        for seed in range(100, 110):
            assert sum(row['seed'] == seed for row in records) == (2 if seed == 103 else 1), records
        assert self.sql(f"SELECT accumulator IS NULL FROM simulation_job WHERE run_id='{run_id}'") == 't'
        self.record('execution: real ten-seed worker checkpoints survive server restart; failed seed resumes without rerunning completed seeds')
        self.record('execution: final artifact/job commit, independent Student t and mean-tensor verification, client v2 write rejection')
        # A second real completed job is disposable, preserving the first ensemble
        # as a browser/report fixture while verifying actual job+artifact deletion.
        disposable = copy.deepcopy(request)
        disposable['runId'] = str(uuid.uuid4())
        disposable['config']['seed'] = 200
        disposable_id = disposable['runId']
        with self.trigger('acceptance_fail_artifact', 'simulation_artifact', 'INSERT',
                          f"IF NEW.run_id='{disposable_id}' THEN RAISE EXCEPTION 'Deliberate acceptance artifact failure'; END IF;"):
            api.request(path + '/simulation-jobs/' + disposable_id, disposable, 'PUT')
            failed = self.wait_job(api, cid, disposable_id, lambda job: job['status'] == 'failed')
        assert failed['completedSeeds'] == 10
        assert self.sql(f"SELECT accumulator IS NOT NULL FROM simulation_job WHERE run_id='{disposable_id}'") == 't'
        assert self.sql(f"SELECT count(*) FROM simulation_run WHERE run_id='{disposable_id}'") == '0'
        assert self.sql(f"SELECT count(*) FROM simulation_artifact WHERE run_id='{disposable_id}'") == '0'
        self.record('transactions: final artifact insert failure rolls back run/completion while retaining all ten checkpoints and accumulator')
        submitted_before = self.model_api.request('/acceptance/status')['submitted']
        self.rollback_upgrade(api, name, fixture, legacy_url, api.request(legacy_url), saved_url, saved, disposable_id, failed)
        api, name = self.start_app('transaction-races', self.args.enabled_war, execution=True)
        api.login()
        api.request(path + '/simulation-jobs/' + disposable_id + '/retry', {}, 'POST')
        self.wait_job(api, cid, disposable_id, lambda job: job['status'] == 'completed')
        assert self.model_api.request('/acceptance/status')['submitted'] == submitted_before
        disposable_url = path + '/simulations/' + disposable_id
        verify_ensemble(api.request(disposable_url))
        self.record('transactions: failed final-save retry completes from ten durable checkpoints without a model rerun')
        self.finalize_delete_race(api, secondary['modified'])
        self.submit_delete_race(api, secondary['calculation'])
        self.stop_app(name, 'transaction-races')
        command(['docker', 'rm', '-f', model_name])
        self.containers.remove(model_name)
        offline, offline_name = self.start_app('offline-reporting', self.args.enabled_war)
        offline.login()
        self.restart_app(offline, offline_name, 'offline-reporting')
        self.record('deployment: same-container restart reuses existing JDBC/datasource configuration and restores authenticated routes')
        assert offline.request('/extensions/ecotwin/capabilities')['execution'] is False
        assert offline.request(saved_url) == saved
        assert offline.request(saved_url + '?view=report')['ensemble'] == saved['ensemble']
        offline.request(url + '/retry', {}, 'POST', 503)
        self.record('reporting-only: persisted v1/v2 summaries and tensors remain readable after restart with model absent')
        # Test actual completed-job deletion, retaining a legacy appendix for browser review.
        offline.request(disposable_url, method='DELETE', status=204)
        offline.request(disposable_url, method='DELETE', status=204)
        assert self.sql(f"SELECT count(*) FROM simulation_job WHERE run_id='{disposable_id}'") == '0'
        assert self.sql(f"SELECT count(*) FROM simulation_artifact WHERE run_id='{disposable_id}'") == '0'
        assert offline.request(saved_url) == saved
        assert offline.request(legacy_url)['result'] == legacy['result']
        self.record('reporting-only: saved ensemble deletion atomically removes artifact/job and is idempotent; native/legacy data retained')
        self.evidence['simulation'] = dict(calculation=cid, legacyRunId=legacy['runId'], ensembleRunId=run_id, testedAndDeletedEnsembleRunId=disposable_id)
        (self.output / 'ensemble-evidence.json').write_text(json.dumps(saved, indent=2) + '\n')
        self.logs(offline_name, 'offline-reporting')
        return offline

    def run(self):
        # Freeze both inputs before any container starts; later local builds cannot
        # change the artifacts under a running acceptance sequence.
        artifacts = self.output / 'artifacts'
        artifacts.mkdir()
        self.evidence['artifacts'] = {}
        for name in ['base_war', 'enabled_war']:
            original = getattr(self.args, name)
            frozen = artifacts / (name + '.war')
            shutil.copyfile(original, frozen)
            self.evidence['artifacts'][name] = dict(source=str(original), sha256=hashlib.sha256(frozen.read_bytes()).hexdigest())
            setattr(self.args, name, frozen)
        archive_assertions(self.args.base_war, self.args.enabled_war)
        self.record('base/enabled WAR archive isolation')
        command(['uv', 'run', str(HERE / 'fixtures.py'), str(self.output / 'fixtures')])
        self.start_database()
        base, base_name = self.start_app('base', self.args.base_war, bootstrap=True)
        self.sql((self.output / 'fixtures/seed.sql').read_text())
        self.sql((self.output / 'fixtures/ui-seed.sql').read_text())
        self.absent(base)
        fixture = self.native(base, 'base')
        self.evidence['fixture'] = fixture
        self.save()
        self.stop_app(base_name, 'base')
        for name in ['SimulationRuns.sql', 'SimulationJobs.sql', 'SimulationBaselines.sql']:
            self.sql((ROOT / 'plugins/ecotwin/migrations' / name).read_text())
        api, enabled_name = self.start_app('enabled', self.args.enabled_war)
        self.enabled(api, fixture)
        secondary = self.native(api, 'enabled')
        self.stop_app(enabled_name, 'enabled')
        api = self.execution(fixture, secondary)
        self.evidence['status'] = 'passed'
        self.evidence['limitations'] = ['Synthetic protocol fixture declares reviewed source identities but contains artificial pixels. Stub tensors test integration only, never ecology.',
            'Base bootstrap WAR copy permits Hibernate DDL only in disposable database; enabled WAR is unmodified.',
            'Code rollback uses this build pair with additive tables retained; historical enabled binaries and destructive schema downgrade are not tested.',
            'Controlled real transaction races cover identical submissions, deletion winning over submit, and finalization winning over native deletion; other interleavings and multi-worker deployment are not supported evidence.',
            'HTTP/native backend coverage; browser and print layout require separate checks.']
        self.save()
        print('Evidence: ' + str(self.output / 'evidence.json'), flush=True)
        if self.args.keep:
            # Browser comparison surfaces share only this disposable DB. Only one
            # enabled worker runs; base/reporting processes never execute models.
            self.start_app('browser-base', self.args.base_war)
            self.start_model()
            browser_api, _ = self.start_app('browser-enabled', self.args.enabled_war, execution=True)
            self.evidence['browserReady'] = True
            self.save()
            print('Retained isolated reporting server: ' + api.base, flush=True)
            print('Retained isolated enabled server: ' + browser_api.base, flush=True)
            print('Cleanup: ' + str(HERE / 'run.py') + ' --cleanup ' + str(self.output / 'evidence.json'), flush=True)

    def cleanup(self):
        for name in reversed(self.containers):
            command(['docker', 'rm', '-f', name], check=False)
        command(['docker', 'network', 'rm', self.network], check=False)


def cleanup(evidence):
    data = json.loads(evidence.read_text())
    network = data['resources']['network']
    assert network.startswith('ecotwin-acceptance-') and network.endswith('-network')
    names = [data['resources']['database']] + ([data['resources']['model']] if 'model' in data['resources'] else []) + [v['container'] for v in data.get('servers', {}).values()]
    for name in names:
        assert name.startswith('ecotwin-acceptance-')
        label = command(['docker', 'inspect', '-f', '{{index .Config.Labels "org.ecotwin.acceptance"}}', name], check=False)
        if label.returncode == 0:
            assert label.stdout.strip() == 'true', 'Refusing to remove unlabelled resource'
            command(['docker', 'rm', '-f', name])
    label = command(['docker', 'network', 'inspect', '-f', '{{index .Labels "org.ecotwin.acceptance"}}', network], check=False)
    if label.returncode == 0:
        assert label.stdout.strip() == 'true'
        command(['docker', 'network', 'rm', network])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-war', type=Path)
    parser.add_argument('--enabled-war', type=Path)
    parser.add_argument('--jdbc-jar', type=Path, default=Path.home() / '.m2/repository/org/postgresql/postgresql/42.7.7/postgresql-42.7.7.jar')
    parser.add_argument('--wildfly-image', default=DEFAULT_WILDFLY)
    parser.add_argument('--database-image', default=DEFAULT_DATABASE)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--keep', action='store_true', help='Retain only these isolated resources for browser review')
    parser.add_argument('--cleanup', type=Path, help='Remove labelled isolated resources listed in an evidence file')
    args = parser.parse_args()
    if args.cleanup:
        cleanup(args.cleanup)
        return
    for name in ['base_war', 'enabled_war', 'jdbc_jar']:
        path = getattr(args, name)
        if path is None or not path.is_file():
            parser.error(f'--{name.replace("_", "-")} must name an existing file')
        setattr(args, name, path.resolve())
    command(['docker', 'info'])
    runner = Acceptance(args)
    try:
        runner.run()
    except Exception as error:
        runner.evidence['status'] = 'failed'
        runner.evidence['error'] = str(error)
        for stage, server in runner.evidence.get('servers', {}).items():
            runner.logs(server['container'], stage)
        runner.save()
        print('Evidence: ' + str(runner.output / 'evidence.json'), flush=True)
        raise
    finally:
        if not args.keep:
            runner.cleanup()


if __name__ == '__main__':
    main()
