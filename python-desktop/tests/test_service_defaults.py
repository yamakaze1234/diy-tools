import copy
import unittest
import test_change_history as history_fixture
from service import Service
from common import AppError


class ServiceDefaultsTests(unittest.TestCase):
    setUp = history_fixture.ChangeHistoryTests.setUp
    tearDown = history_fixture.ChangeHistoryTests.tearDown

    def test_shop_defaults_survive_save_and_restart(self):
        incoming = copy.deepcopy(self.s.state)
        incoming.update(baseRevision=incoming['revision'], baseState=copy.deepcopy(self.s.state))
        incoming['shopSettings']['intel']['serviceText'] = '英特尔专属承诺'
        incoming['shopSettings']['jonsbo']['serviceText'] = ''
        self.s.update_state(incoming, self.cookie)
        self.s.close()
        self.s = Service(self.s.root, self.local, transport=lambda *_: self.fail('unexpected network'))
        self.s.cloud.paused = True
        self.assertEqual(self.s.state['shopSettings']['intel']['serviceText'], '英特尔专属承诺')
        self.assertEqual(self.s.state['shopSettings']['jonsbo']['serviceText'], '')
        self.assertNotIn('serviceText', self.s.state['shopSettings']['gigabyte'])

    def test_invalid_default_rejected(self):
        for text in [123, 'x' * 1001]:
            incoming = copy.deepcopy(self.s.state)
            incoming.update(baseRevision=incoming['revision'], baseState=copy.deepcopy(self.s.state))
            incoming['shopSettings']['intel']['serviceText'] = text
            with self.assertRaises(AppError):
                self.s.update_state(incoming, self.cookie)
