"""Batch save contracts against isolated local files and synthetic login."""
import copy
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from test_backend import ROOT, STATE, transport
from common import AppError, atomic, dumps
from service import Service


class BatchSaveTests(unittest.TestCase):
    def setUp(self):
        directory = ROOT / '.verification'
        directory.mkdir(exist_ok=True)
        self.local = Path(tempfile.mkdtemp(prefix='batch-', dir=directory))
        atomic(self.local / 'state.json', dumps(STATE))
        self.s = Service(ROOT, self.local, transport=transport)
        self.s.cloud.paused = True
        self.s.cloud.login(dict(accessToken='A'))
        self.cookie = 'diy_session=' + self.s.cloud.cookie

    def tearDown(self):
        self.s.close()

    def request(self, ids=(0,), field='actualParts'):
        configs = self.s.state['configs']
        changes = []
        for i in ids:
            base = copy.deepcopy(configs[i])
            after = copy.deepcopy(base)
            after[field][0]['qty'] += 1
            changes.append(dict(id=base['id'], base=base, after=after))
        return dict(operationId=str(uuid.uuid4()), baseRevision=self.s.state['revision'],
                    message='批量测试', changes=changes)

    def test_actual_only_receipt_and_unselected_records(self):
        before = copy.deepcopy(self.s.state)
        payload = self.request((0, 1))
        receipt = self.s.update_configs_batch(payload, self.cookie)
        self.assertEqual(len(receipt['configs']), 2)
        self.assertNotIn('logs', receipt)
        self.assertEqual(self.s.state['configs'][2], before['configs'][2])
        self.assertEqual(self.s.state['configs'][0]['parts'], before['configs'][0]['parts'])
        self.assertEqual(self.s.state['configs'][0]['actualParts'][0]['qty'], before['configs'][0]['actualParts'][0]['qty'] + 1)
        self.assertEqual(self.s.store.meta('workspaceState'), self.s.state)
        self.assertEqual(len(self.s.store.local_history()['records']), 1)
        self.assertEqual(self.s.update_configs_batch(payload, self.cookie), receipt)
        self.assertEqual(len(self.s.store.local_history()['records']), 1)

    def test_bad_second_record_rolls_back_entire_batch(self):
        before = copy.deepcopy(self.s.state)
        payload = self.request((0, 1))
        payload['changes'][1]['after']['actualParts'][0]['qty'] = -1
        with self.assertRaises(AppError):
            self.s.update_configs_batch(payload, self.cookie)
        self.assertEqual(self.s.state, before)
        self.assertEqual(self.s.store.local_history()['records'], [])

    def test_sqlite_failure_after_record_writes_rolls_back(self):
        payload = self.request((0, 1))
        with patch.object(self.s.store, 'set_meta', side_effect=RuntimeError('synthetic transaction fault')):
            with self.assertRaises(RuntimeError):
                self.s.update_configs_batch(payload, self.cookie)
        self.assertEqual(self.s.state['revision'], payload['baseRevision'])
        self.assertIsNone(self.s.store.get('configuration', payload['changes'][0]['id']))
        self.assertIsNone(self.s.store.batch_receipt(payload['operationId']))
        self.assertEqual(self.s.store.local_history()['records'], [])

    def test_duplicate_id_and_deleted_target_rejected(self):
        payload = self.request((0, 1))
        payload['changes'][1] = copy.deepcopy(payload['changes'][0])
        with self.assertRaisesRegex(AppError, '重复'):
            self.s.update_configs_batch(payload, self.cookie)
        self.s.state['configs'][0]['deletedAt'] = '2026-09-26T00:00:00Z'
        with self.assertRaisesRegex(AppError, '删除'):
            self.s.update_configs_batch(self.request(), self.cookie)

    def test_login_and_cloud_bootstrap_gate(self):
        payload = self.request()
        with self.assertRaises(AppError):
            self.s.update_configs_batch(payload, '')
        self.s.store.set_meta('enabled', True)
        with self.assertRaisesRegex(AppError, '首次云端数据'):
            self.s.update_configs_batch(payload, self.cookie)
        self.assertEqual(self.s.state['revision'], payload['baseRevision'])

    def test_failed_precommit_history_backup_prevents_business_write(self):
        payload = self.request()
        with patch.object(self.s.history, 'record', side_effect=OSError('synthetic backup failure')):
            with self.assertRaises(OSError):
                self.s.update_configs_batch(payload, self.cookie)
        self.assertEqual(self.s.state['revision'], payload['baseRevision'])
        self.assertIsNone(self.s.store.batch_receipt(payload['operationId']))

    def test_join_discards_local_drafts_before_first_cloud_push(self):
        payload = self.request()
        self.s.update_configs_batch(payload, self.cookie)
        self.assertIsNotNone(self.s.store.get('configuration', payload['changes'][0]['id']))
        history = self.s.store.local_history()['records']
        original_call = self.s.cloud.call

        def ready(action, *args, **kwargs):
            if action == 'session.get':
                return dict(ok=True, uid='A', memberId='A', workspaceId='synthetic-team', ready=True)
            return original_call(action, *args, **kwargs)

        # Keep the background worker from racing direct Store assertions on its
        # shared SQLite connection; this test exercises the join transition.
        with patch.object(self.s.cloud, 'call', side_effect=ready), patch.object(self.s.cloud, 'schedule'):
            self.s.cloud.enable(dict(mode='join'), self.cookie)
        self.assertTrue(self.s.store.meta('enabled'))
        self.assertEqual(self.s.store.records(), [])
        self.assertEqual(self.s.store.next_batch(), [])
        self.assertEqual(self.s.store.local_history()['records'], history,
                         f"workspace={self.s.store.meta('workspaceId')} rows={[tuple(row) for row in self.s.store.db.execute('SELECT seq,workspace FROM local_changes')]}")
        self.assertTrue(list((self.local / 'backups').glob('before-sync-*.json')))
        with self.assertRaisesRegex(AppError, '首次云端数据'):
            self.s.update_configs_batch(payload, self.cookie)

    def test_local_only_drafts_do_not_block_same_workspace_member_switch(self):
        payload = self.request()
        self.s.update_configs_batch(payload, self.cookie)
        original = self.s.store.get('configuration', payload['changes'][0]['id'])
        history = self.s.store.local_history()['records']
        self.assertFalse(self.s.store.meta('enabled'))
        self.assertGreater(self.s.store.status()['pending'], 0)
        self.s.store.switch_member('synthetic-team', 'B')
        self.assertEqual(self.s.store.meta('uid'), 'B')
        self.assertEqual(self.s.store.get('configuration', payload['changes'][0]['id']), original)
        self.assertEqual(self.s.store.local_history()['records'], history)
        self.assertTrue(self.s.store.db.execute('SELECT 1 FROM backups').fetchone())

    def test_unchanged_batch_keeps_revision_and_history(self):
        config = copy.deepcopy(self.s.state['configs'][0])
        payload = dict(operationId=str(uuid.uuid4()), baseRevision=self.s.state['revision'],
                       changes=[dict(id=config['id'], base=config, after=copy.deepcopy(config))])
        receipt = self.s.update_configs_batch(payload, self.cookie)
        self.assertTrue(receipt['unchanged'])
        self.assertEqual(self.s.state['revision'], payload['baseRevision'])
        self.assertEqual(self.s.store.local_history()['records'], [])

    def test_unaffected_product_file_is_untouched(self):
        extra = copy.deepcopy(self.s.state['configs'][2])
        extra['id'] = str(uuid.uuid4())
        extra['productId'] = 'other-link'
        extra['spu'] = '789'
        extra['skuId'] = '7891'
        self.s.state['configs'].append(extra)
        index = self.s.save_standard_products(self.s.state)
        other = next(row for row in index['links'] if row['productId'] == 'other-link')
        path = self.local / 'products-standard' / other['file']
        before = (path.read_bytes(), path.stat().st_mtime_ns)
        self.s.update_configs_batch(self.request(), self.cookie)
        self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), before)
        saved_index = json.loads((self.local / 'products-standard/index.json').read_text(encoding='utf-8'))
        self.assertEqual(saved_index['revision'], self.s.state['revision'])
        self.assertIn(other['file'], [row['file'] for row in saved_index['links']])

    def test_failed_product_sidecar_is_rebuilt_on_next_unrelated_save(self):
        self.s.state['configs'][0]['skuId'] = '123'
        self.s.state['configs'][0]['spu'] = '123'
        extra = copy.deepcopy(self.s.state['configs'][2])
        extra['id'] = str(uuid.uuid4())
        extra['productId'] = 'other-link'
        extra['spu'] = '789'
        extra['skuId'] = '7891'
        self.s.state['configs'].append(extra)
        index = self.s.save_standard_products(self.s.state)
        first = next(row for row in index['links'] if row['productId'] == 'product')
        target = self.local / 'products-standard' / first['file']
        before_content = target.read_bytes()
        original = __import__('service').atomic

        def fail_first_product(path, data):
            if Path(path) == target:
                raise OSError('synthetic derived file failure')
            return original(path, data)

        with patch('service.atomic', side_effect=fail_first_product):
            with self.assertRaises(OSError):
                self.s.update_configs_batch(self.request(), self.cookie)
        self.assertGreater(self.s.state['revision'], index['revision'])
        self.assertEqual(target.read_bytes(), before_content)
        # The next edit touches only another link. The stale index forces a
        # complete rebuild, including the earlier failed link.
        second = dict(operationId=str(uuid.uuid4()), baseRevision=self.s.state['revision'],
                      changes=[dict(id=extra['id'], base=copy.deepcopy(extra), after=copy.deepcopy(extra))])
        second['changes'][0]['after']['actualParts'][0]['qty'] += 1
        self.s.update_configs_batch(second, self.cookie)
        self.assertNotEqual(target.read_bytes(), before_content)
        refreshed = json.loads((self.local / 'products-standard/index.json').read_text(encoding='utf-8'))
        self.assertEqual(refreshed['revision'], self.s.state['revision'])
        self.assertEqual(first['file'], next(row for row in refreshed['links'] if row['productId'] == 'product')['file'])

    def test_stale_independent_field_merges_and_same_field_conflicts(self):
        payload = self.request()
        incoming = copy.deepcopy(self.s.state)
        incoming.update(baseRevision=incoming['revision'], baseState=copy.deepcopy(self.s.state))
        incoming['configs'][0]['sampleNote'] = '来自另一页面'
        self.s.update_state(incoming, self.cookie)
        receipt = self.s.update_configs_batch(payload, self.cookie)
        self.assertTrue(receipt['rebased'])
        self.assertEqual(self.s.state['configs'][0]['sampleNote'], '来自另一页面')
        stale = self.request()
        incoming = copy.deepcopy(self.s.state)
        incoming.update(baseRevision=incoming['revision'], baseState=copy.deepcopy(self.s.state))
        incoming['configs'][0]['actualParts'][0]['qty'] += 2
        self.s.update_state(incoming, self.cookie)
        with self.assertRaisesRegex(AppError, '同一字段'):
            self.s.update_configs_batch(stale, self.cookie)

    def test_full_save_between_batches_cannot_be_overwritten_by_stale_draft(self):
        self.s.update_configs_batch(self.request(), self.cookie)
        incoming = copy.deepcopy(self.s.state)
        incoming.update(baseRevision=incoming['revision'], baseState=copy.deepcopy(self.s.state))
        incoming['configs'][0]['sampleNote'] = '全量保存的独立字段'
        self.s.update_state(incoming, self.cookie)
        self.s.update_configs_batch(self.request(), self.cookie)
        self.assertEqual(self.s.state['configs'][0]['sampleNote'], '全量保存的独立字段')
        draft = self.s.store.get('configuration', self.s.state['configs'][0]['id'])['draft']
        self.assertEqual(draft['sampleNote'], '全量保存的独立字段')

    def test_committed_snapshot_survives_sidecar_failure_and_restart(self):
        payload = self.request()
        original = __import__('service').atomic

        def fail_state(path, data):
            if Path(path).name == 'state.json':
                raise OSError('synthetic sidecar failure')
            return original(path, data)

        with patch('service.atomic', side_effect=fail_state):
            with self.assertRaises(OSError):
                self.s.update_configs_batch(payload, self.cookie)
        revision = self.s.state['revision']
        self.s.close()
        self.s = Service(ROOT, self.local, transport=transport)
        self.s.cloud.paused = True
        self.s.cloud.login(dict(accessToken='A'))
        self.cookie = 'diy_session=' + self.s.cloud.cookie
        self.assertEqual(self.s.state['revision'], revision)
        self.assertEqual(self.s.update_configs_batch(payload, self.cookie)['revision'], revision)
        self.assertEqual(json.loads((self.local / 'state.json').read_text(encoding='utf-8'))['revision'], revision)


if __name__ == '__main__':
    unittest.main()
