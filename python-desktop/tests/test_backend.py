import copy
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from common import AppError, atomic, digest, dumps, now
from domain import Domain
from service import Service
from store import Store
from server import start_server
from sql_service import normalize, read_bundle, QUERIES
from credentials import Credentials
import requests

STATE = json.loads((ROOT / 'tests/fixtures/state.json').read_text(encoding='utf-8'))
RECORDS = json.loads((ROOT / 'tests/fixtures/records.json').read_text(encoding='utf-8'))
SETTINGS = dict(server='synthetic-host', port=1433, database='synthetic-db', user='reader', encrypt=True, trustServerCertificate=False)
BUNDLE = dict(warehouses=[{'goods_id': '123', '库房': '公司大库', '商品编码': 'SKU123', '商品名称': 'ERP 原名', '分库数': 9, '分库待入': 0, '分库可销数': 8, '库存成本': 99.25}], catalog=[{'goods_id': '123', '商品编码': 'SKU123', '商品名称': 'ERP 原名'}, {'goods_id': '124', '商品编码': 'SKU124', '商品名称': '新配件'}])


def transport(request, token):
    if request['action'] == 'session.get':
        return dict(ok=True, uid=token, memberId=token, workspaceId='synthetic-team', name='测试成员 ' + token, ready=False)
    raise AssertionError('Unexpected cloud write/network request')


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = ROOT / '.verification'
        cls.directory.mkdir(exist_ok=True)

    def setUp(self):
        # Retained until final review then recycled by the build cleanup step.
        self.local = Path(tempfile.mkdtemp(prefix='backend-', dir=self.directory))
        atomic(self.local / 'state.json', dumps(STATE))
        self.s = Service(ROOT, self.local, transport=transport, sql_reader=lambda *_: copy.deepcopy(BUNDLE))
        self.s.cloud.paused = True
        self.s.cloud.login(dict(accessToken='A'))
        self.cookie = 'diy_session=' + self.s.cloud.cookie

    def tearDown(self):
        self.s.close()

    def seed_cloud(self):
        records = RECORDS + [dict(type='workspace_meta', id='root', data=dict(format=2))]
        changes = [dict(**r, seq=i+1, version=1, updatedAt=now(), updatedBy='B') for i, r in enumerate(records)]
        self.s.store.apply_page(dict(ok=True, changes=changes, nextCursor=len(changes), headSeq=len(changes), hasMore=False))
        self.s.store.set_meta('enabled', True)
        self.s.store.set_meta('workspaceState', self.s.state)

    def test_local_edit_keeps_cloud_queue_until_two_hour_deadline(self):
        self.s.cloud.close()
        self.seed_cloud()
        cloud = self.s.cloud
        cloud.paused = False
        cloud.manual_requested = False
        deadline = cloud.next_auto_sync
        incoming = copy.deepcopy(self.s.state)
        incoming.update(baseRevision=incoming['revision'], baseState=copy.deepcopy(self.s.state))
        incoming['configs'][0]['name'] = '仅本机修改'
        with patch.object(cloud, 'schedule') as schedule:
            self.s.update_state(incoming, self.cookie)
            schedule.assert_not_called()
        self.assertGreater(self.s.store.status()['pending'], 0)
        self.assertEqual(cloud.next_auto_sync, deadline)
        self.assertIsNone(cloud.begin_cycle())
        with patch('cloud.time.time', return_value=deadline / 1000):
            self.assertEqual(cloud.begin_cycle(), ('A', cloud.epoch))
        self.assertEqual(cloud.next_auto_sync, deadline + 7200000)
        self.assertEqual(self.s.store.meta('nextAutoSyncAt'), cloud.next_auto_sync)

    def test_manual_sync_works_while_auto_sync_paused_and_coalesces(self):
        self.s.cloud.close()
        self.seed_cloud()
        cloud = self.s.cloud
        cloud.manual_requested = False
        self.assertIsNone(cloud.begin_cycle())
        cloud.schedule(manual=True)
        self.assertEqual(cloud.begin_cycle(), ('A', cloud.epoch))
        cloud.schedule(manual=True)
        self.assertFalse(cloud.manual_requested)
        self.assertIsNone(cloud.begin_cycle())
        cloud.running = False
        self.assertIsNone(cloud.begin_cycle())

    def test_existing_workspace_login_does_not_start_sync(self):
        self.s.cloud.close()
        self.seed_cloud()
        cloud = self.s.cloud
        cloud.manual_requested = False
        cloud.paused = False
        cloud.login(dict(accessToken='A'))
        self.assertFalse(cloud.manual_requested)
        self.assertIsNone(cloud.begin_cycle())

    def test_pure_rule_and_projection_parity_with_node(self):
        self.assertEqual(self.s.domain('projectWorkspace', STATE), RECORDS)
        actual = self.s.domain('applyWorkspace', STATE, RECORDS)
        self.assertEqual(actual['configs'][0]['parts'][0]['erp'], 100)
        self.assertEqual(actual['configs'][0]['parts'][0]['name'], '输出源优化描述')
        self.assertEqual(actual['costSource'][0]['tax'], 120)
        self.assertEqual(self.s.domain('projectWorkspace', actual), RECORDS)

    def test_upgrade_backup_preserves_original(self):
        marker = json.loads((self.local / 'python-backend-migration.json').read_text())
        saved = json.loads((Path(marker['backup']) / 'state.json').read_text(encoding='utf-8'))
        self.assertEqual(saved, STATE)

    def test_http_login_gate_csrf_origin_and_logout(self):
        server = start_server(self.s)
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            self.assertEqual(requests.get(base + '/api/state').status_code, 401)
            self.assertEqual(requests.get(base + '/seed.json').status_code, 401)
            self.assertEqual(requests.get(base + '/.env.local').status_code, 403)
            self.assertEqual(requests.get(base + '/api/state', headers={'Host': 'attacker.test'}).status_code, 403)
            self.assertEqual(requests.get(base + '/api/workspace-sync/status').status_code, 403)
            session = requests.Session()
            headers = {'X-DIY-Sync': self.s.cloud.csrf}
            response = session.post(base + '/api/workspace-sync/session', json={'accessToken': 'A'}, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(session.get(base + '/api/state').json()['configs'][0]['name'], '配置1')
            self.assertEqual(session.post(base + '/api/state', json={}, headers={'Origin': 'https://evil.example'}).status_code, 403)
            self.assertEqual(session.post(base + '/api/workspace-sync/logout', json={}, headers=headers).status_code, 200)
            self.assertEqual(session.get(base + '/api/state').status_code, 401)
        finally:
            server.shutdown()
            server.server_close()

    def test_sql_uses_exact_id_unit_cost_and_keeps_manual_price(self):
        self.seed_cloud()
        pending = self.s.sql_preview(dict(settings=SETTINGS, password='synthetic', remember=True), self.cookie)
        self.assertEqual(pending['unknown'], 1)
        self.assertEqual(self.s.state['costSource'][0]['erp'], 100)
        result = self.s.sql_apply(pending['id'], self.cookie)
        self.assertTrue(result['ok'])
        row = self.s.state['costSource'][0]
        self.assertEqual((row['erp'], row['stockAvailable'], row['tax']), (99.25, 8, 120))
        self.assertEqual(self.s.state['configs'][0]['parts'][0]['name'], '输出源优化描述')
        self.assertEqual(self.s.store.status()['pending'], 0)
        with self.assertRaises(AppError):
            self.s.sql_apply(pending['id'], self.cookie)

    def test_sql_preview_rejects_changed_state_and_changed_identity(self):
        pending = self.s.sql_preview(dict(settings=SETTINGS, password='synthetic'), self.cookie)
        self.s.state = {**self.s.state, 'revision': 1}
        with self.assertRaisesRegex(AppError, '配置数据已变化'):
            self.s.sql_apply(pending['id'], self.cookie)
        pending = self.s.sql_preview(dict(settings=SETTINGS, password='synthetic'), self.cookie)
        self.s.cloud.logout(self.cookie)
        self.s.cloud.login(dict(accessToken='B'))
        with self.assertRaises(AppError):
            self.s.sql_apply(pending['id'], 'diy_session=' + self.s.cloud.cookie)

    def test_expired_preview_rejected(self):
        preview = self.s.sql_preview(dict(settings=SETTINGS, password='synthetic'), self.cookie)
        self.s.previews[preview['id']]['expiresAt'] = 0
        with self.assertRaises(AppError):
            self.s.sql_apply(preview['id'], self.cookie)

    def test_vault_encrypted_roundtrip_and_member_isolation(self):
        member = dumps(['synthetic-team', 'A'])
        self.s.credentials.save(member, SETTINGS, 'synthetic-secret-123')
        files = list((self.local / 'sql-credentials').glob('*.json'))
        self.assertNotIn('synthetic-secret-123', files[0].read_text())
        reopened = Credentials(self.local)
        self.assertEqual(reopened.read(member)['password'], 'synthetic-secret-123')
        self.assertFalse(reopened.read(dumps(['synthetic-team', 'B']))['saved'])
        reopened.clear(member)
        self.assertFalse(reopened.read(member)['saved'])

    def test_sql_duplicate_bad_numeric_and_warehouse_isolation(self):
        bundle = copy.deepcopy(BUNDLE)
        bundle['warehouses'].append({**bundle['warehouses'][0], '库房': '其他库房', '分库可销数': 9999, '库存成本': 9999})
        self.assertEqual(normalize(bundle)[0]['erp'], 99.25)
        bundle['warehouses'].append(bundle['warehouses'][0])
        with self.assertRaises(AppError):
            normalize(bundle)
        for bad in (True, float('nan'), '', 'wrong'):
            bundle = copy.deepcopy(BUNDLE)
            bundle['warehouses'][0]['库存成本'] = bad
            with self.assertRaises(AppError):
                normalize(bundle)

    def test_sql_driver_fixed_readonly_queries_timeout_and_redacted_errors(self):
        class Connection:
            def __init__(self):
                self.queries, self.closed = [], False
            def cursor(self):
                return self
            def execute(self, value):
                self.queries.append(value)
            def fetchmany(self, count):
                return []
            def close(self):
                self.closed = True
        connection, options = Connection(), {}
        def connector(**kwargs):
            options.update(kwargs)
            return connection
        read_bundle(SETTINGS, 'secret-not-in-errors', connector)
        self.assertEqual(connection.queries, QUERIES)
        self.assertTrue(connection.closed)
        self.assertTrue(options['readonly'])
        self.assertTrue(options['cafile'])
        self.assertTrue(options['validate_host'])
        self.assertEqual((options['login_timeout'], options['timeout']), (10, 30))
        def failing(**kwargs):
            raise RuntimeError('login failed for secret-not-in-errors')
        with self.assertRaises(AppError) as error:
            read_bundle(SETTINGS, 'secret-not-in-errors', failing)
        self.assertNotIn('secret-not-in-errors', str(error.exception))

    def test_outbox_survives_restart_and_retries_identical_mutation(self):
        self.seed_cloud()
        record = RECORDS[0]
        data = {**record['data'], 'name': '本机修改'}
        self.s.store.edit_many([dict(type=record['type'], id=record['id'], data=data)])
        batch = self.s.store.next_batch()
        another = Store(self.local / 'workspace.sqlite', self.s.domain)
        try:
            self.assertEqual(batch, another.next_batch())
            self.assertEqual(another.status()['uncertain'], 1)
            response = dict(ok=True, record=dict(type=record['type'], id=record['id'], data=data, version=2))
            another.acknowledge(batch, [response])
            self.assertEqual(another.status()['uncertain'], 0)
            self.assertEqual(another.status()['pending'], 0)
        finally:
            another.close()

    def test_invalid_page_rolls_back_rows_and_cursor(self):
        record = RECORDS[0]
        page = dict(ok=True, changes=[dict(**record, seq=1, version=1)], headSeq=2, nextCursor=2, hasMore=False)
        with self.assertRaises(AppError):
            self.s.store.apply_page(page)
        self.assertEqual(self.s.store.records(), [])
        self.assertEqual(self.s.store.status()['cursor'], 0)

    def test_conflict_preserves_local_and_can_select_remote(self):
        self.seed_cloud()
        record = RECORDS[0]
        self.s.store.edit_many([{**record, 'data': {**record['data'], 'name': '本机修改'}}])
        cursor = self.s.store.status()['cursor']
        change = dict(**record, seq=cursor + 1, version=2)
        change['data'] = {**record['data'], 'name': '其他成员修改'}
        self.s.store.apply_page(dict(ok=True, changes=[change], nextCursor=cursor+1, headSeq=cursor+1, hasMore=False))
        row = self.s.store.get(record['type'], record['id'])
        self.assertEqual(row['draft']['name'], '本机修改')
        self.assertIn('name', row['conflict']['fields'])
        self.s.store.resolve(record['type'], record['id'], 'remote')
        self.assertEqual(self.s.store.get(record['type'], record['id'])['draft']['name'], '其他成员修改')

    def test_pending_edits_prevent_account_switch(self):
        self.seed_cloud()
        record = RECORDS[0]
        self.s.store.edit_many([{**record, 'data': {**record['data'], 'name': '本机修改'}}])
        self.s.cloud.logout(self.cookie)
        with self.assertRaisesRegex(AppError, '未同步'):
            self.s.cloud.login(dict(accessToken='B'))

    def test_restore_preview_and_revision_guard(self):
        state = copy.deepcopy(self.s.state)
        incoming = {**state, 'baseRevision': state['revision'], 'message': '测试保存'}
        incoming['configs'][0]['name'] = '修改后'
        self.s.update_state(incoming, self.cookie)
        version = self.s.history.list(self.s.scope())[-1]
        preview = self.s.history.preview(version['id'], self.s.scope(), self.s.state)
        with self.assertRaises(AppError):
            self.s.restore({**preview, 'baseRevision': -1}, self.cookie)
        self.s.restore(preview, self.cookie)
        self.assertEqual(self.s.state['configs'][0]['name'], '配置1')

    def test_sql_wait_does_not_hold_state_lock(self):
        entered, release = threading.Event(), threading.Event()
        def reader(*_):
            entered.set()
            release.wait(5)
            return BUNDLE
        self.s.sql_reader = reader
        outcomes = []
        worker = threading.Thread(target=lambda: outcomes.append(self.s.sql_preview(dict(settings=SETTINGS, password='synthetic'), self.cookie)))
        worker.start()
        self.assertTrue(entered.wait(2))
        start = time.monotonic()
        with self.s.lock:
            self.s.cloud.status()
        elapsed = time.monotonic() - start
        release.set()
        worker.join(5)
        self.assertLess(elapsed, 0.2)
        self.assertEqual(len(outcomes), 1)

    def test_cloud_download_2000_records_and_local_erp_preserved(self):
        records = [dict(type='component', id='test-scope|' + str(1000+i), data=dict(erpScopeId='test-scope', goodsId=str(1000+i), name='合成配件', taxCents=100)) for i in range(2000)] + RECORDS + [dict(type='workspace_meta', id='root', data=dict(format=2))]
        changes = [dict(**r, version=1, seq=i+1, updatedAt=now(), updatedBy='B') for i, r in enumerate(records)]
        calls = []
        def fake(request, token):
            self.assertEqual(request['action'], 'sync.pull')
            cursor = request['payload']['cursor']
            page = changes[cursor:cursor+100]
            calls.append(cursor)
            return dict(ok=True, changes=page, headSeq=len(changes), nextCursor=cursor+len(page), hasMore=cursor+len(page)<len(changes))
        self.s.cloud.transport = fake
        self.s.store.set_meta('enabled', True)
        self.s.cloud.cycle('A', self.s.cloud.epoch)
        self.assertGreater(len(calls), 20)
        self.assertEqual(self.s.cloud.progress['cursor'], len(changes))
        self.assertEqual(self.s.state['costSource'][0]['erp'], 100)
        self.assertEqual(len(self.s.state['costSource']), 2001)
        self.assertEqual(self.s.store.status()['pending'], 0)


if __name__ == '__main__':
    unittest.main()
