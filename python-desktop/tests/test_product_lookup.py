import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import AppError
from sql_service import read_product

CONFIG = dict(server='test', database='test', user='reader', encrypt=False, trustServerCertificate=False)

class LookupTests(unittest.TestCase):
    def query(self, rows, goods_id='123'):
        calls = {}
        class Connection:
            def cursor(self): return self
            def execute(self, sql, args): calls.update(sql=sql, args=args)
            def fetchall(self): return rows
            def close(self): calls['closed'] = True
        def connect(**kwargs):
            calls.update(kwargs)
            return Connection()
        result = read_product(CONFIG, 'test-password', goods_id, connect)
        self.assertTrue(calls['readonly'])
        self.assertTrue(calls['closed'])
        self.assertEqual(calls['args'], (goods_id,))
        self.assertIn('%s', calls['sql'])
        return result

    def test_exact_name_and_price(self):
        row = self.query([dict(goods_id='123', name='ERP 原始名称', erp=25.5)])
        self.assertEqual((row['name'], row['erp']), ('ERP 原始名称', 25.5))

    def test_missing_price_not_zero(self):
        self.assertIsNone(self.query([dict(goods_id='123', name='配件', erp=None)])['erp'])
        self.assertEqual(self.query([dict(goods_id='123', name='配件', erp=0)])['erp'], 0)

    def test_unknown_id(self):
        self.assertFalse(self.query([])['found'])

    def test_duplicate_or_wrong_id_rejected(self):
        for rows in [[dict(goods_id='124')], [dict(goods_id='123'), dict(goods_id='123')]]:
            with self.assertRaises(AppError): self.query(rows)

    def test_invalid_id_rejected_before_connection(self):
        for key in [None, '', '123 OR 1=1', '1.0', '001']:
            with self.assertRaises(AppError): self.query([], key)

if __name__ == '__main__': unittest.main()
