import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_backend import ROOT, STATE, RECORDS, transport
from common import AppError, atomic, dumps, now
from service import Service
from server import start_server
import requests


class ChangeHistoryTests(unittest.TestCase):
    def setUp(self):
        root = ROOT / '.verification'
        root.mkdir(exist_ok=True)
        self.local = Path(tempfile.mkdtemp(prefix='change-history-', dir=root))
        atomic(self.local / 'state.json', dumps(STATE))
        self.s = Service(ROOT, self.local, transport=transport)
        self.s.cloud.paused = True
        self.s.cloud.login(dict(accessToken='A'))
        self.cookie = 'diy_session=' + self.s.cloud.cookie
        records = RECORDS + [dict(type='workspace_meta', id='root', data=dict(format=2))]
        self.changes = [dict(**r, seq=i+1, version=1, updatedAt=now(), updatedBy='B', mutationId=f'synthetic-commit-{i}') for i, r in enumerate(records)]
        self.s.store.apply_page(dict(ok=True, changes=self.changes, nextCursor=len(records), headSeq=len(records), hasMore=False))
        self.s.store.set_meta('enabled', True)
        self.s.store.set_meta('workspaceState', self.s.state)

    def tearDown(self):
        self.s.close()

    def edit(self, name):
        incoming = copy.deepcopy(self.s.state)
        incoming.update(baseRevision=incoming['revision'], baseState=copy.deepcopy(self.s.state))
        incoming['configs'][0]['name'] = name
        return self.s.update_state(incoming, self.cookie)

    def fake_cloud(self, request, token):
        if request['action'] == 'records.commits':
            before = request['payload'].get('before', len(self.changes)+1)
            selected = [c for c in reversed(self.changes) if c['seq'] < before][:50]
            return dict(ok=True, records=[dict(id=c.get('mutationId'), seq=c['seq'], type=c['type'], entityId=c['id'], version=c['version'], at=c.get('updatedAt'), actorId=c.get('updatedBy'), data=c['data']) for c in selected], nextBefore=selected[-1]['seq'] if len(selected)==50 else None)
        if request['action'] == 'sync.bootstrap':
            return dict(ok=True, headSeq=len(self.changes))
        self.assertEqual(request['action'], 'sync.pull')
        p = request['payload']
        # Force byte-limited pagination: one record per HTTP response.
        rows = self.changes[p['cursor']:min(p['cursor']+1, p['headSeq'])]
        cursor = p['cursor'] + len(rows)
        return dict(ok=True, changes=rows, nextCursor=cursor, headSeq=p['headSeq'], hasMore=cursor < p['headSeq'])

    def test_local_audit_keeps_author_before_after_and_survives_restart(self):
        self.edit('第一次修改')
        first = self.s.store.local_history()['records'][0]
        self.edit('第二次修改')
        rows = self.s.store.local_history()['records']
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]['id'], first['id'])
        self.assertEqual(rows[0]['actor']['uid'], 'A')
        self.assertEqual(rows[0]['changes'][0]['before']['name'], '第一次修改')
        self.assertEqual(rows[0]['changes'][0]['after']['name'], '第二次修改')
        self.assertEqual(rows[1], first)
        self.s.close()
        self.s = Service(ROOT, self.local, transport=transport)
        self.s.cloud.paused = True
        self.assertEqual(self.s.store.local_history()['records'], rows)

    def test_unchanged_save_does_not_add_history(self):
        self.edit('已修改')
        self.edit('已修改')
        self.assertEqual(len(self.s.store.local_history()['records']), 1)

    def test_disabled_sync_still_logs_local_save(self):
        self.s.store.set_meta('enabled', False)
        self.edit('尚未开启同步')
        self.assertEqual(self.s.store.local_history()['records'][0]['changes'][0]['after']['name'], '尚未开启同步')

    def test_local_history_pagination_and_failed_edit_transaction(self):
        for i in range(51):
            self.edit(f'修改 {i}')
        first = self.s.store.local_history()
        second = self.s.store.local_history(first['nextBefore'])
        self.assertEqual(len(first['records']), 50)
        self.assertEqual(len(second['records']), 1)
        self.assertIsNone(second['nextBefore'])
        original = next(r for r in self.s.store.records() if r['type'] == 'configuration')
        with self.assertRaises(Exception):
            self.s.store.edit_many([
                dict(type=original['type'], id=original['id'], data={**original['draft'], 'name': '应回滚'}),
                dict(type='invalid', id='bad', data={})], actor=self.s.cloud.audit_actor())
        self.assertEqual(self.s.store.get(original['type'], original['id']), original)
        self.assertEqual(self.s.store.local_history(), first)

    def test_cloud_commit_pagination_has_no_gaps(self):
        initial = self.changes[0]
        self.changes = [{**initial, 'seq': i+1, 'mutationId': f'commit-{i}'} for i in range(53)]
        self.s.cloud.transport = self.fake_cloud
        first = self.s.cloud.inspect_changes('commits', {}, self.cookie)
        second = self.s.cloud.inspect_changes('commits', dict(before=first['nextBefore']), self.cookie)
        self.assertEqual([r['seq'] for r in first['records'] + second['records']], list(range(53, 0, -1)))
        self.assertIsNone(second['nextBefore'])

    def test_commits_use_server_id_time_and_author_without_mutating_local(self):
        self.s.cloud.transport = self.fake_cloud
        snapshot = self.s.store.db.total_changes
        result = self.s.cloud.inspect_changes('commits', {}, self.cookie)
        self.assertEqual(len(result['records']), len(self.changes))
        latest = result['records'][0]
        self.assertEqual(latest['id'], self.changes[-1]['mutationId'])
        self.assertEqual(latest['at'], self.changes[-1]['updatedAt'])
        self.assertEqual(latest['actorId'], 'B')
        self.assertIsNone(latest['actorName'])
        self.assertEqual(snapshot, self.s.store.db.total_changes)

    def test_history_http_routes_require_session_and_csrf(self):
        self.edit('HTTP 修改')
        self.s.cloud.transport = self.fake_cloud
        server = start_server(self.s)
        url = f'http://127.0.0.1:{server.server_port}/api/workspace-sync/'
        headers = {'X-DIY-Sync': self.s.cloud.csrf, 'Cookie': self.cookie}
        try:
            self.assertEqual(requests.post(url+'local-history', json={}).status_code, 403)
            self.assertEqual(requests.post(url+'local-history', json={}, headers={'X-DIY-Sync': self.s.cloud.csrf}).status_code, 401)
            for action in ('local-history', 'commits', 'compare'):
                response = requests.post(url+action, json={}, headers=headers)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertGreater(len(response.json()['records']), 0)
        finally:
            server.shutdown()
            server.server_close()

    def test_compare_exposes_three_versions_and_does_not_pull_into_local(self):
        self.edit('本机名字')
        original = next(c for c in self.changes if c['type'] == 'configuration')
        remote = {**original, 'data': {**original['data'], 'name': '云端名字'}, 'version': 2, 'seq': len(self.changes)+1}
        self.changes.append(remote)
        self.s.cloud.transport = self.fake_cloud
        cursor = self.s.store.meta('cursor')
        snapshot = self.s.store.db.total_changes
        result = self.s.cloud.inspect_changes('compare', {}, self.cookie)
        row = next(r for r in result['records'] if r['type'] == 'configuration')
        self.assertEqual(row['local']['name'], '本机名字')
        self.assertEqual(row['cloud']['name'], '云端名字')
        self.assertIn('name', row['fields'])
        self.assertEqual(self.s.store.meta('cursor'), cursor)
        self.assertEqual(snapshot, self.s.store.db.total_changes)
        self.assertEqual(self.s.state['configs'][0]['name'], '本机名字')

    def test_compare_rejects_identity_change_during_network_request(self):
        def fake(request, token):
            result = self.fake_cloud(request, token)
            self.s.cloud.epoch += 1
            return result
        self.s.cloud.transport = fake
        with self.assertRaisesRegex(AppError, '同步已停止'):
            self.s.cloud.inspect_changes('commits', {}, self.cookie)

    def test_unconfirmed_push_never_starts_pull_and_retry_keeps_id(self):
        self.edit('待提交')
        ids = []
        def fail(request, token):
            self.assertEqual(request['action'], 'sync.pushBatch')
            ids.append(request['payload']['requests'][0]['payload']['mutationId'])
            raise AppError('提交结果未确认')
        self.s.cloud.transport = fail
        with patch.object(self.s.cloud, 'upload_assets'):
            for _ in range(2):
                with self.assertRaisesRegex(AppError, '未确认'):
                    self.s.cloud.cycle('A', self.s.cloud.epoch)
        self.assertEqual(ids[0], ids[1])
        self.assertGreater(self.s.store.status()['uncertain'], 0)

    def test_confirmed_push_is_acknowledged_before_pull(self):
        self.edit('成功提交')
        calls = []
        def fake(request, token):
            calls.append(request['action'])
            if request['action'] == 'sync.pushBatch':
                results = []
                for item in request['payload']['requests']:
                    p = item['payload']
                    change = dict(type=p['entityType'], id=p['entityId'], version=p['baseVersion']+1, data=p['after'], seq=len(self.changes)+1, updatedBy='A', updatedAt=now(), mutationId=p['mutationId'])
                    self.changes.append(change)
                    results.append(dict(ok=True, record=change))
                return dict(ok=True, results=results)
            self.assertEqual(self.s.store.status()['uncertain'], 0)
            p = request['payload']
            rows = self.changes[p['cursor']:]
            return dict(ok=True, changes=rows, nextCursor=len(self.changes), headSeq=len(self.changes), hasMore=False)
        self.s.cloud.transport = fake
        with patch.object(self.s.cloud, 'upload_assets'):
            self.s.cloud.cycle('A', self.s.cloud.epoch)
        self.assertEqual(calls, ['sync.pushBatch', 'sync.pull'])
        self.assertEqual(self.s.store.status()['pending'], 0)


if __name__ == '__main__':
    unittest.main()
