"""Exercise web wire records through the real Python desktop sync path."""
import copy
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parent
sys.path.insert(0, str(ROOT))
from common import atomic, dumps
from service import Service


class CrossClientCloudTests(unittest.TestCase):
    def test_web_python_web_template_order_and_edit(self):
        bridge = PROJECT / 'web-lite/tests/python-cross-client.mjs'
        def node(mode, payload=None):
            result = subprocess.run(['node', str(bridge), mode], cwd=PROJECT,
                                    input=json.dumps(payload, ensure_ascii=False) if payload else None,
                                    text=True, capture_output=True, check=True)
            return json.loads(result.stdout)

        log = node('generate')['log']
        rows = {(row['type'], row['id']): row for row in log}
        receipts = {}
        def transport(request, token):
            self.assertEqual(token, 'synthetic-token')
            if request['action'] == 'sync.pull':
                payload = request['payload']
                head = payload.get('headSeq', len(log))
                changes = [copy.deepcopy(row) for row in log
                           if payload['cursor'] < row['seq'] <= head][:3]
                cursor = changes[-1]['seq'] if changes else payload['cursor']
                return dict(ok=True, changes=changes, headSeq=head,
                            nextCursor=cursor, hasMore=cursor < head)
            if request['action'] == 'sync.pushBatch':
                results = []
                for item in request['payload']['requests']:
                    payload = item['payload']
                    mutation = payload['mutationId']
                    if mutation not in receipts:
                        key = (payload['entityType'], payload['entityId'])
                        current = rows.get(key)
                        self.assertEqual(payload['baseVersion'], current['version'] if current else 0)
                        row = dict(type=key[0], id=key[1], data=copy.deepcopy(payload['after']),
                                   version=(current['version'] if current else 0) + 1,
                                   seq=len(log) + 1)
                        rows[key] = row
                        log.append(row)
                        receipts[mutation] = dict(ok=True, record=copy.deepcopy(row))
                    results.append(copy.deepcopy(receipts[mutation]))
                return dict(ok=True, results=results)
            raise AssertionError('unexpected synthetic request: ' + request['action'])

        verification = ROOT / 'verification/optimization-20260927'
        verification.mkdir(parents=True, exist_ok=True)
        local = Path(tempfile.mkdtemp(prefix='python-cross-client-', dir=verification))
        state = json.loads((ROOT / 'tests/fixtures/state.json').read_text(encoding='utf-8'))
        atomic(local / 'state.json', dumps(state))
        service = Service(ROOT, local, transport=transport, sql_reader=lambda *_: {})
        try:
            cloud = service.cloud
            cloud.paused = True
            cloud.token = 'synthetic-token'
            cloud.member = dict(ok=True, uid='test-user', memberId='test-member',
                                workspaceId='test-workspace', name='隔离测试成员', ready=True)
            cloud.cookie = 'synthetic-cookie'
            cloud.expires = time.time() + 3600
            service.store.switch_member('test-workspace', 'test-user')
            service.store.set_meta('enabled', True)
            cloud.cycle(cloud.token, cloud.epoch)
            self.assertEqual([row['id'] for row in service.state['configs']],
                             ['config-one', 'web-python-copy'])
            self.assertEqual(service.state['templates'][0]['id'], 'web-python-template')
            self.assertEqual(service.state['templates'][0]['name'], '网页新建模板')
            self.assertLess(service.state['configs'][0]['workspaceOrder'],
                            service.state['configs'][1]['workspaceOrder'])

            before = copy.deepcopy(service.state)
            edited = copy.deepcopy(before)
            edited.update(baseRevision=before['revision'], baseState=before)
            edited['configs'][1]['name'] = 'Python 桌面修改'
            service.update_state(edited, 'diy_session=synthetic-cookie')
            cloud.cycle(cloud.token, cloud.epoch)
            self.assertEqual(service.store.status()['pending'], 0)
            web = node('receive', {'log': log})
            self.assertEqual([row['id'] for row in web['configs']],
                             ['config-one', 'web-python-copy'])
            self.assertEqual(web['configs'][1]['name'], 'Python 桌面修改')
            self.assertEqual(web['templates'][0]['id'], 'web-python-template')
        finally:
            service.close()


if __name__ == '__main__':
    unittest.main()
