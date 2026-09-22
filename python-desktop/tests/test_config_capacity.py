import copy
import unittest
import test_backend
from service import Service
from common import AppError

class ConfigCapacityTests(unittest.TestCase):
    directory = test_backend.ROOT / '.verification'
    setUp = test_backend.BackendTests.setUp
    tearDown = test_backend.BackendTests.tearDown

    def test_more_than_500_configs_save_and_reopen(self):
        incoming = copy.deepcopy(self.s.state)
        before = copy.deepcopy(self.s.state)
        reference = incoming['configs'][0]
        incoming['configs'] = [dict(copy.deepcopy(reference), id=f'capacity-{i}', productId=f'product-{i//20}') for i in range(501)]
        incoming.update(baseRevision=before['revision'], baseState=before)
        result = self.s.update_state(incoming, self.cookie)
        self.assertEqual(len(result['state']['configs']), 501)
        self.s.close()
        self.s = Service(test_backend.ROOT, self.local, transport=test_backend.transport)
        self.assertEqual(len(self.s.state['configs']), 501)

    def test_per_shop_8000_in_python_business_engine(self):
        configs = [dict(id=f'{shop}-{i}', shopId=shop) for shop in ['intel', 'gigabyte', 'jonsbo'] for i in range(8000)]
        self.assertTrue(self.s.domain('validateConfigCapacity', configs))
        with self.assertRaisesRegex(AppError, '8000'):
            self.s.domain('validateConfigCapacity', configs+[dict(id='extra',shopId='intel')])
