import copy
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from product_jobs import ProductJobs
from common import AppError
from domain import Domain


class ProductJobTests(unittest.TestCase):
    def setUp(self):
        self.domain = Domain(ROOT)
        self.jobs = ProductJobs(lambda value: self.domain('parseStandardProduct', value))
        self.jobs.session('member-session-A')
        self.target = dict(erpShopId='18', spu='10020445846503', account='测试账号')
        self.identity = dict(clientId='test-browser', account='测试账号')

    def tearDown(self):
        self.domain.close()

    def claim(self):
        self.jobs.start(self.target)
        claim = self.jobs.poll(self.identity)['job']
        return dict(**self.identity, jobId=claim['id'], token=claim['token'])

    def test_account_and_page_bound_one_time_claim(self):
        packet = self.claim()
        self.assertIsNone(self.jobs.poll(self.identity)['job'])
        public = self.jobs.status()['job']
        self.assertNotIn('token', public)
        for key, value in [('account', '其他账号'), ('clientId', 'other'), ('token', 'wrong')]:
            with self.assertRaises(AppError):
                self.jobs.collect('result', {**packet, key: value, 'result': {'SKU': {}}})
        self.jobs.collect('result', {**packet, 'result': {'SKU': {}}})
        self.assertEqual(self.jobs.status()['job']['status'], 'complete')
        with self.assertRaises(AppError):
            self.jobs.collect('result', {**packet, 'result': {'SKU': {}}})

    def test_timeout_cancel_session_change_and_wrong_account_cannot_refresh_again(self):
        self.jobs.start(self.target)
        self.assertIsNone(self.jobs.poll({**self.identity, 'account': '其他账号'})['job'])
        self.jobs.job['deadline'] = 0
        self.assertEqual(self.jobs.status()['job']['status'], 'failed')
        packet = self.claim()
        self.jobs.cancel()
        with self.assertRaises(AppError):
            self.jobs.collect('result', {**packet, 'result': {'SKU': {}}})
        self.jobs.session('member-session-B')
        self.assertIsNone(self.jobs.status()['job'])
        with self.assertRaises(AppError):
            self.jobs.verify(packet)

    def test_result_target_and_contract_validation(self):
        packet = self.claim()
        bad = {'店铺ID': '19', 'SPU编码': self.target['spu'], 'SKU': {'123': {'SKU名称': '配置'}}}
        with self.assertRaises(AppError):
            self.jobs.collect('result', {**packet, 'result': bad})
        bad['店铺ID'] = '18'
        bad['SKU']['123']['SKU明细'] = [{'goods_id': '47538', 'n': 0.5}]
        with self.assertRaises(Exception):
            self.jobs.collect('result', {**packet, 'result': bad})
        bad['SKU']['123']['SKU明细'][0]['n'] = 1
        self.jobs.collect('result', {**packet, 'result': bad})
        self.assertEqual(self.jobs.status()['job']['result']['SKU']['123']['SKU明细'][0]['goods_id'], '47538')

    def test_invalid_requests_and_overlapping_job(self):
        for payload in [{**self.target, 'erpShopId': ''}, {**self.target, 'spu': 123}, {**self.target, 'account': ''}]:
            with self.assertRaises(AppError):
                self.jobs.start(payload)
        self.jobs.start(self.target)
        with self.assertRaises(AppError):
            self.jobs.start(self.target)


if __name__ == '__main__':
    unittest.main()
