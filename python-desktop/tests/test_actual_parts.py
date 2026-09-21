import copy
import unittest

import test_change_history as history_fixture
from service import Service
from common import AppError


class ActualPartsTests(unittest.TestCase):
    # Same isolated old-record fixture, with all network writes forbidden.
    setUp = history_fixture.ChangeHistoryTests.setUp
    tearDown = history_fixture.ChangeHistoryTests.tearDown

    def save_actual(self, rows):
        incoming = copy.deepcopy(self.s.state)
        incoming.update(baseRevision=incoming['revision'], baseState=copy.deepcopy(self.s.state))
        incoming['configs'][0]['actualParts'] = copy.deepcopy(rows)
        return self.s.update_state(incoming, self.cookie)

    def test_actual_edit_migrates_only_edited_record_and_unchanged_save_is_noop(self):
        rows = copy.deepcopy(self.s.state['configs'][0]['actualParts'])
        rows[0]['qty'] = 4
        rows[0]['name'] = '实际 CPU 独立名称'
        self.save_actual(rows)
        config = self.s.state['configs'][0]
        self.assertEqual(config['actualParts'][0]['qty'], 4)
        self.assertEqual(config['parts'][0]['qty'], 1)
        self.assertNotEqual(config['parts'][0]['name'], rows[0]['name'])
        changed = self.s.store.local_history()['records']
        self.assertEqual(len(changed), 1)
        self.assertEqual(len(changed[0]['changes']), 1)
        self.save_actual(config['actualParts'])
        self.assertEqual(self.s.store.local_history()['records'], changed)

    def test_explicit_empty_actual_bill_survives_restart(self):
        self.save_actual([])
        self.s.close()
        self.s = Service(self.s.root, self.local, transport=lambda *_: self.fail('unexpected network'))
        self.s.cloud.paused = True
        self.assertEqual(self.s.state['configs'][0]['actualParts'], [])
        self.assertGreater(len(self.s.state['configs'][0]['parts']), 0)

    def test_sync_retry_keeps_mutation_and_materializes_actual_parts(self):
        rows = copy.deepcopy(self.s.state['configs'][0]['actualParts'])
        rows[0]['qty'] = 4
        self.save_actual(rows)
        attempts = []

        def transport(request, token):
            if request['action'] == 'sync.pushBatch':
                batch = request['payload']['requests']
                attempts.append(copy.deepcopy(batch))
                if len(attempts) == 1:
                    raise AppError('simulated lost acknowledgement')
                return dict(ok=True, results=[dict(ok=True, record=dict(
                    type=r['payload']['entityType'], id=r['payload']['entityId'],
                    version=r['payload']['baseVersion'] + 1,
                    data=r['payload']['after'])) for r in batch])
            if request['action'] == 'sync.pull':
                cursor = self.s.store.meta('cursor')
                return dict(ok=True, changes=[], headSeq=cursor,
                            nextCursor=cursor, hasMore=False)
            self.fail('Unexpected action: ' + request['action'])

        self.s.cloud.transport = transport
        with self.assertRaisesRegex(AppError, 'simulated lost acknowledgement'):
            self.s.cloud.cycle('A', self.s.cloud.epoch)
        self.assertGreater(self.s.store.status()['pending'], 0)
        self.s.cloud.cycle('A', self.s.cloud.epoch)
        self.assertEqual(attempts[0], attempts[1])
        self.assertEqual(self.s.store.status()['pending'], 0)
        self.assertEqual(self.s.state['configs'][0]['actualParts'][0]['qty'], 4)
        self.assertIsNotNone(self.s.cloud.last_synced)


if __name__ == '__main__':
    unittest.main()
