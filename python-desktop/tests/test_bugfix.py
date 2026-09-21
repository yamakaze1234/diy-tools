import copy
import unittest
import test_backend
from common import AppError

class BugfixTests(unittest.TestCase):
    setUpClass = classmethod(test_backend.BackendTests.setUpClass.__func__)
    setUp = test_backend.BackendTests.setUp
    tearDown = test_backend.BackendTests.tearDown
    def test_stale_save_merges_independent_fields_but_rejects_same_field(self):
        base = copy.deepcopy(self.s.state)
        first = copy.deepcopy(base)
        first.update(baseRevision=base['revision'], baseState=base)
        first['configs'][0]['name'] = 'new remote name'
        self.s.update_state(first, self.cookie)
        second = copy.deepcopy(base)
        second.update(baseRevision=base['revision'], baseState=base)
        second['configs'][0]['version'] = 'new local version'
        result = self.s.update_state(second, self.cookie)
        self.assertEqual(result['state']['configs'][0]['name'], 'new remote name')
        self.assertEqual(result['state']['configs'][0]['version'], 'new local version')
        second['configs'][0]['name'] = 'conflicting local name'
        with self.assertRaises(AppError) as caught:
            self.s.update_state(second, self.cookie)
        self.assertEqual(caught.exception.status, 409)

    def test_recovery_draft_keeps_unsaved_data_when_cloud_token_expired(self):
        import requests, json
        from server import start_server
        server = start_server(self.s, 0)
        try:
            self.s.cloud.token = None
            url = f'http://127.0.0.1:{server.server_port}/api/recovery-draft'
            response = requests.post(url, json={'state': self.s.state}, headers={'Cookie': self.cookie})
            self.assertEqual(response.status_code, 200)
            from pathlib import Path
            saved = json.loads(Path(response.json()['file']).read_text(encoding='utf8'))
            self.assertEqual(saved['configs'], self.s.state['configs'])
            self.assertEqual(requests.post(url, json={'state': self.s.state}).status_code, 401)
        finally:
            server.shutdown();server.server_close()

    def test_old_inflight_401_retries_new_token_without_logging_out(self):
        from unittest.mock import patch
        self.s.cloud.transport = None
        self.s.config = {'envId': 'synthetic-env', 'functionName': 'workbenchApi'}
        seen = []
        class Response:
            def __init__(self, ok):
                self.ok = ok
                self.status_code = 200 if ok else 401
            def json(self):
                return {'ok': True} if self.ok else {'code': 'UNAUTHENTICATED'}
        def post(url, **kwargs):
            seen.append(kwargs['headers']['Authorization'])
            if len(seen) == 1:
                self.s.cloud.token = 'renewed'
                return Response(False)
            return Response(True)
        with patch('cloud.requests.post', side_effect=post):
            self.assertTrue(self.s.cloud.call('sync.pull', {}, 'A')['ok'])
        self.assertEqual(seen, ['Bearer A', 'Bearer renewed'])
        self.assertEqual(self.s.cloud.token, 'renewed')
