"""Isolated HTTP check using the same local backend as the desktop window."""
import copy
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from common import atomic, dumps
from service import Service
from server import start_server
from test_backend import STATE, transport


class ProfitBackendTest(unittest.TestCase):
    def test_http_run_and_accounting_when_erp_unavailable(self):
        directory = ROOT / '.verification'
        directory.mkdir(exist_ok=True)
        local = Path(tempfile.mkdtemp(prefix='profit-http-', dir=directory))
        state = copy.deepcopy(STATE)
        config = state['configs'][0]
        config['price'] = 7999
        config['installment'] = 12
        for peer in state['configs']:
            if peer.get('productId') == config.get('productId'):
                peer['installment'] = 12
        config['actualParts'] = [dict(slot='CPU', name='处理器', goodsId='123', qty=1, tax=6440)]
        atomic(local / 'state.json', dumps(state))
        service = Service(ROOT, local, transport=transport,
                          profit_cost_reader=lambda *_: dict(costs={'123': 652000}, failed=[], collectedAt='2026-09-24T00:00:00Z'))
        service.cloud.paused = True
        service.cloud.login(dict(accessToken='A'))
        template = copy.deepcopy(config)
        template.update(id='excluded-template', productCategory='主机模板')
        service.state['configs'].append(template)
        server = start_server(service)
        session = requests.Session()
        session.cookies.set('diy_session', service.cloud.cookie)
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            denied = session.post(base + '/api/profit/start', json=dict(requestId='template-test-001', shopId=config['shopId'], configIds=['excluded-template']))
            self.assertEqual(denied.status_code, 409)
            with patch.object(service.credentials, 'read', return_value=dict(saved=True, settings={}, password='synthetic')):
                response = session.post(base + '/api/profit/start', json=dict(requestId='test-run-001', shopId=config['shopId'], configIds=[config['id']]))
                self.assertEqual(response.status_code, 200, response.text)
                run_id = response.json()['runId']
                for _ in range(50):
                    report = session.post(base + '/api/profit/status', json=dict(runId=run_id)).json()
                    if report['run']['status'] != 'running':
                        break
                    time.sleep(.05)
                self.assertEqual(report['run']['status'], 'completed', report)
                results = {r['metric']: r for r in report['results']}
                self.assertEqual(results['erp']['profit_cents'], 83908, results['erp'])
                self.assertEqual(results['accounting']['profit_cents'], 65910)
            with patch.object(service.credentials, 'read', side_effect=ValueError('unavailable')):
                next_run = session.post(base + '/api/profit/start', json=dict(requestId='test-run-002', shopId=config['shopId'], configIds=[config['id']])).json()['runId']
                for _ in range(50):
                    report = session.post(base + '/api/profit/status', json=dict(runId=next_run)).json()
                    if report['run']['status'] != 'running':
                        break
                    time.sleep(.05)
                results = {r['metric']: r for r in report['results']}
                self.assertFalse(results['erp']['valid'])
                self.assertTrue(results['accounting']['valid'])
            published = service.profit.set_publish(dict(enabled=True, directory=str(local)))
            self.assertIsNone(published['error'])
            manifest = json.loads((local / 'profit-monitor' / 'manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(manifest['contract'], 'profit-monitor/v1')
            self.assertTrue(manifest['complete'])
            self.assertNotIn('erp', json.dumps(manifest['configs'], ensure_ascii=False))
            peers = [c for c in service.state['configs'] if c.get('productId') == config.get('productId')]
            if len(peers) > 1:
                peers[1]['installment'] = 24
                service.state['revision'] += 1
                service.profit.publish()
                mixed = json.loads((local / 'profit-monitor' / 'manifest.json').read_text(encoding='utf-8'))
                self.assertIsNone(next(c for c in mixed['configs'] if c['configId'] == config['id'])['feeCents'])
        finally:
            server.shutdown()
            server.server_close()
            service.close()


if __name__ == '__main__':
    unittest.main()
