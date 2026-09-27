import sqlite3
import unittest

from profit_rules import business_snapshot, calculate, cents, compare
from profit_store import ProfitStore
from sql_service import read_costs


def sample(price=7999, term=12, erp=6520, tax=6440):
    config = dict(id='config-1', shopId='intel', productId='link-1', product='链接', name='测试配置',
                  price=price, installment=term, actualParts=[dict(slot='CPU', name='处理器', goodsId='123', qty=1, tax=tax)])
    snapshot = business_snapshot(config)
    return snapshot, {'123': cents(erp)}


class ProfitCheckTest(unittest.TestCase):
    def test_golden_overview_values(self):
        for price, term, erp, tax, fee, expected_erp, expected_tax in [
            (7999, 12, 6520, 6440, 47994, 83908, 65910),
            (7199, 24, 6249, 6169, 71990, 8612, -7786),
            (8599, 0, 8498.59, 8359, 0, -7157, -20396),
            (5999, 24, 5222, 5132, 59990, 5712, -7286),
            (7199, 24, 6116, 6116, 71990, 21912, -2486),
            (7199, 24, 6166.36, 6166.36, 71990, 16876, -7522),
        ]:
            with self.subTest(price=price):
                snapshot, costs = sample(price, term, erp, tax)
                self.assertEqual(snapshot['feeCents'], fee)
                self.assertEqual(calculate(snapshot, costs, 'erp')['profitCents'], expected_erp)
                self.assertEqual(calculate(snapshot, costs, 'accounting')['profitCents'], expected_tax)

    def test_accounting_price_changes_include_commission_and_version_isolates_baseline(self):
        from unittest.mock import patch
        db = sqlite3.connect(':memory:', isolation_level=None)
        db.row_factory = sqlite3.Row
        store = ProfitStore(db)
        first, costs = sample(price=5999, term=24, tax=5132)
        with patch('profit_store.FORMULA_VERSION', 'profit/v1'):
            old_run, _ = store.start('old-formula', 'local', 1, [first], {'config-1': 'old'})
            old_result = dict(valid=True, reason='', profitCents=-3818, totalCostCents=513200)
            store.finish(old_run, [(first, 'accounting', old_result, {})])
        run, _ = store.start('new-formula', 'local', 2, [first], {'config-1': 'new'})
        details = dict(parts=[{**first['parts'][0], 'unitCostCents': 513200}])
        store.finish(run, [(first, 'accounting', calculate(first, costs, 'accounting'), details)])
        row = store.get(run)['results'][0]
        self.assertEqual(store.get(run)['run']['formula'], 'profit/v2')
        self.assertIsNone(row['previous_id'])
        self.assertFalse(row['changed'])
        second, costs = sample(price=6099, term=24, tax=5132)
        run, _ = store.start('price-change', 'local', 3, [second], {'config-1': 'changed'})
        store.finish(run, [(second, 'accounting', calculate(second, costs, 'accounting'), details)])
        detail = store.get(run)['results'][0]['details']
        self.assertEqual(detail['priceImpactCents'], 9600)
        self.assertEqual(detail['feeImpactCents'], -1000)
        self.assertEqual(detail['roundingAndBasisImpactCents'], 0)
        db.close()

    def test_independent_validity_and_strict_thresholds(self):
        snapshot, costs = sample()
        self.assertFalse(calculate(snapshot, {}, 'erp')['valid'])
        self.assertTrue(calculate(snapshot, {}, 'accounting')['valid'])
        snapshot['parts'][0]['taxCents'] = None
        self.assertFalse(calculate(snapshot, costs, 'accounting')['valid'])
        self.assertTrue(calculate(snapshot, costs, 'erp')['valid'])
        self.assertFalse(compare(-30000)['loss'])
        self.assertTrue(compare(-30001)['loss'])
        self.assertFalse(compare(40000, anchor=50000)['change'])
        self.assertTrue(compare(39999, anchor=50000)['change'])
        self.assertFalse(compare(42000, anchor=50000)['change'])
        self.assertTrue(compare(38000, anchor=50000)['change'])

    def test_store_migration_and_independent_baselines(self):
        db = sqlite3.connect(':memory:', isolation_level=None)
        db.row_factory = sqlite3.Row
        store = ProfitStore(db)
        ProfitStore(db)
        snapshot, costs = sample()
        for i, erp in enumerate((50000, 46000, 42000, 38000)):
            run, created = store.start(f'check-{i:04}', 'local', i, [snapshot], {snapshot['configId']: 'hash'})
            self.assertTrue(created)
            result = dict(valid=True, reason='', profitCents=erp, totalCostCents=100)
            tax_result = dict(valid=True, reason='', profitCents=20000, totalCostCents=200)
            store.finish(run, [(snapshot, 'erp', result, {}), (snapshot, 'accounting', tax_result, {})])
            rows = store.get(run)['results']
            erp_row = next(row for row in rows if row['metric'] == 'erp')
            tax_row = next(row for row in rows if row['metric'] == 'accounting')
            self.assertFalse(tax_row['changed'])
            self.assertEqual(bool(erp_row['changed']), i == 3)
        run, _ = store.start('interrupted', 'local', 5, [snapshot], {snapshot['configId']: 'hash'})
        ProfitStore(db)
        self.assertEqual(store.get(run)['run']['status'], 'interrupted')

    def test_exact_id_batches_preserve_partial_failure(self):
        class Cursor:
            calls = 0
            def execute(self, query, ids):
                self.calls += 1
                self.ids = ids
                assert "[库房]=N'公司大库'" in query
                if self.calls == 2:
                    raise RuntimeError('one batch failed')
            def fetchall(self):
                return [dict(goods_id=key, 库存成本='0' if key == '1' else '1.25') for key in self.ids]
        class Connection:
            cursor_value = Cursor()
            def cursor(self):
                return self.cursor_value
            def close(self):
                pass
        connection = Connection()
        settings = dict(server='test', database='test', user='reader', port=1433, encrypt=False)
        result = read_costs(settings, 'test', {str(n) for n in range(1, 502)}, connector=lambda **_: connection)
        self.assertEqual(connection.cursor_value.calls, 2)
        self.assertEqual(result['costs']['1'], 0)
        self.assertEqual(len(result['failed']), 1)
        self.assertNotIn(result['failed'][0], result['costs'])

    def test_replacement_and_price_only_causes(self):
        db = sqlite3.connect(':memory:', isolation_level=None)
        db.row_factory = sqlite3.Row
        store = ProfitStore(db)
        first, _ = sample(price=1000, term=0, erp=100, tax=100)
        run, _ = store.start('cause-001', 'local', 1, [first], {first['configId']: 'first'})
        base = dict(valid=True, reason='', profitCents=88000, totalCostCents=10000)
        details = dict(parts=[{**first['parts'][0], 'unitCostCents': 10000}])
        store.finish(run, [(first, 'erp', base, details)])
        second, _ = sample(price=1200, term=0, erp=100, tax=100)
        second['parts'][0]['goodsId'] = '456'
        second['parts'][0]['name'] = '新处理器'
        run, _ = store.start('cause-002', 'local', 2, [second], {second['configId']: 'second'})
        changed = dict(valid=True, reason='', profitCents=107600, totalCostCents=10000)
        details = dict(parts=[{**second['parts'][0], 'unitCostCents': 10000}])
        store.finish(run, [(second, 'erp', changed, details)])
        causes = store.get(run)['results'][0]['details']
        self.assertEqual([c['kind'] for c in causes['causes']], ['removed', 'added'])
        self.assertEqual((causes['causes'][0]['beforeQty'], causes['causes'][0]['afterQty']), (1, 0))
        self.assertEqual((causes['causes'][1]['beforeUnitCostCents'], causes['causes'][1]['afterUnitCostCents']), (None, 10000))
        self.assertEqual(sum(c['profitImpactCents'] for c in causes['causes']), 0)
        self.assertEqual(causes['priceImpactCents'], 19600)
        self.assertEqual(causes['roundingAndBasisImpactCents'], 0)


if __name__ == '__main__':
    unittest.main()
