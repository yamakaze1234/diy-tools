"""Local profit history. No cloud records or existing tables are modified."""
import json
from common import dumps, now, uid
from profit_rules import FORMULA_VERSION, compare, rounded
from decimal import Decimal


class ProfitStore:
    def __init__(self, db):
        self.db = db
        with self.transaction():
            db.execute('CREATE TABLE IF NOT EXISTS profit_schema(version INTEGER NOT NULL)')
            if not db.execute('SELECT 1 FROM profit_schema').fetchone():
                db.execute('INSERT INTO profit_schema VALUES(1)')
            db.execute('''CREATE TABLE IF NOT EXISTS profit_runs(
                id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, workspace TEXT NOT NULL,
                revision INTEGER NOT NULL, source TEXT NOT NULL, formula TEXT NOT NULL,
                status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
                covered INTEGER NOT NULL, error TEXT)''')
            db.execute('''CREATE TABLE IF NOT EXISTS profit_snapshots(
                run_id TEXT NOT NULL, shop_id TEXT NOT NULL, config_id TEXT NOT NULL,
                content_hash TEXT NOT NULL, content TEXT NOT NULL,
                PRIMARY KEY(run_id,shop_id,config_id))''')
            db.execute('''CREATE TABLE IF NOT EXISTS profit_results(
                id TEXT PRIMARY KEY, run_id TEXT NOT NULL, workspace TEXT NOT NULL,
                shop_id TEXT NOT NULL, config_id TEXT NOT NULL, metric TEXT NOT NULL,
                valid INTEGER NOT NULL, profit_cents INTEGER, cost_cents INTEGER,
                previous_id TEXT, anchor_id TEXT, previous_delta_cents INTEGER,
                anchor_delta_cents INTEGER, loss INTEGER NOT NULL, changed INTEGER NOT NULL,
                recovered INTEGER NOT NULL, reason TEXT NOT NULL, details TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(run_id,shop_id,config_id,metric))''')
            db.execute('''CREATE TABLE IF NOT EXISTS profit_baselines(
                workspace TEXT NOT NULL, shop_id TEXT NOT NULL, config_id TEXT NOT NULL,
                metric TEXT NOT NULL, source TEXT NOT NULL, formula TEXT NOT NULL,
                latest_id TEXT NOT NULL, anchor_id TEXT NOT NULL, anchor_cents INTEGER NOT NULL,
                was_loss INTEGER NOT NULL, PRIMARY KEY(workspace,shop_id,config_id,metric,source,formula))''')
            db.execute('''CREATE TABLE IF NOT EXISTS profit_settings(
                key TEXT PRIMARY KEY, value TEXT NOT NULL)''')
            db.execute("INSERT OR IGNORE INTO profit_settings VALUES('retention','no-auto-prune-v1')")
            db.execute("INSERT OR IGNORE INTO profit_settings VALUES('lossCents','-30000')")
            db.execute("INSERT OR IGNORE INTO profit_settings VALUES('changeCents','10000')")
            db.execute("UPDATE profit_runs SET status='interrupted',finished_at=? WHERE status='running'", (now(),))

    def transaction(self):
        from contextlib import contextmanager
        @contextmanager
        def tx():
            self.db.execute('BEGIN IMMEDIATE')
            try:
                yield
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK')
                raise
        return tx()

    def start(self, request_id, workspace, revision, snapshots, hashes):
        existing = self.db.execute('SELECT id FROM profit_runs WHERE request_id=?', (request_id,)).fetchone()
        if existing:
            return existing[0], False
        run_id = uid()
        with self.transaction():
            self.db.execute('INSERT INTO profit_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                            (run_id, request_id, workspace, revision, 'manual', FORMULA_VERSION,
                             'running', now(), None, len(snapshots), None))
            for snapshot in snapshots:
                self.db.execute('INSERT INTO profit_snapshots VALUES(?,?,?,?,?)',
                                (run_id, snapshot['shopId'], snapshot['configId'], hashes[snapshot['configId']], dumps(snapshot)))
        return run_id, True

    def finish(self, run_id, observations):
        run = self.db.execute('SELECT * FROM profit_runs WHERE id=?', (run_id,)).fetchone()
        if not run or run['status'] != 'running':
            return
        with self.transaction():
            for snapshot, metric, result, details in observations:
                key = (run['workspace'], snapshot['shopId'], snapshot['configId'], metric, run['source'], run['formula'])
                baseline = self.db.execute('''SELECT * FROM profit_baselines WHERE
                    workspace=? AND shop_id=? AND config_id=? AND metric=? AND source=? AND formula=?''', key).fetchone()
                valid = result['valid']
                previous = self.db.execute('SELECT profit_cents FROM profit_results WHERE id=?', (baseline['latest_id'],)).fetchone() if baseline else None
                if baseline and result['valid'] and previous:
                    old = self.db.execute('''SELECT r.details,s.content FROM profit_results r JOIN profit_snapshots s
                        ON s.run_id=r.run_id AND s.shop_id=r.shop_id AND s.config_id=r.config_id
                        WHERE r.id=?''', (baseline['latest_id'],)).fetchone()
                    if old:
                        old_snapshot, old_details = json.loads(old['content']), json.loads(old['details'])
                        old_lines = {p['lineId']: p for p in old_details.get('parts', [])}
                        new_lines = {p['lineId']: p for p in details.get('parts', [])}
                        causes = []
                        for line_id in sorted(old_lines.keys() | new_lines.keys()):
                            before, after = old_lines.get(line_id), new_lines.get(line_id)
                            before_sum = (before.get('unitCostCents') or 0) * (before.get('qty') or 0) if before else 0
                            after_sum = (after.get('unitCostCents') or 0) * (after.get('qty') or 0) if after else 0
                            if before and after and (before.get('goodsId') != after.get('goodsId') or before.get('name') != after.get('name')):
                                causes.append(dict(lineId=line_id, kind='removed', name=before.get('name'),
                                                   beforeCents=before_sum, afterCents=0, beforeQty=before.get('qty'), afterQty=0,
                                                   beforeUnitCostCents=before.get('unitCostCents'), afterUnitCostCents=None,
                                                   profitImpactCents=before_sum))
                                causes.append(dict(lineId=line_id, kind='added', name=after.get('name'),
                                                   beforeCents=0, afterCents=after_sum, beforeQty=0, afterQty=after.get('qty'),
                                                   beforeUnitCostCents=None, afterUnitCostCents=after.get('unitCostCents'),
                                                   profitImpactCents=-after_sum))
                            elif before_sum != after_sum:
                                causes.append(dict(lineId=line_id, name=(after or before).get('name'),
                                                   beforeCents=before_sum, afterCents=after_sum,
                                                   beforeQty=before.get('qty') if before else 0,
                                                   afterQty=after.get('qty') if after else 0,
                                                   beforeUnitCostCents=before.get('unitCostCents') if before else None,
                                                   afterUnitCostCents=after.get('unitCostCents') if after else None,
                                                   profitImpactCents=before_sum-after_sum))
                        price_delta = snapshot['priceCents']-old_snapshot['priceCents']
                        price_effect = (price_delta - (rounded(Decimal(snapshot['priceCents']) * Decimal('.04'))
                                                       - rounded(Decimal(old_snapshot['priceCents']) * Decimal('.04')))
                                        if metric == 'accounting' else rounded(Decimal(price_delta) * Decimal('.98')))
                        fee_effect = old_snapshot['feeCents']-snapshot['feeCents']
                        cost_effect = sum(c['profitImpactCents'] for c in causes)
                        residual = result['profitCents']-previous[0]-price_effect-fee_effect-cost_effect
                        details = {**details, 'causes': causes,
                                   'priceImpactCents': price_effect, 'feeImpactCents': fee_effect,
                                   'roundingAndBasisImpactCents': residual}
                flags = compare(result['profitCents'], previous[0] if previous else None,
                                baseline['anchor_cents'] if baseline else None, baseline['was_loss'] if baseline else False) if valid else dict(loss=False, change=False, recovered=False, previousDeltaCents=None, anchorDeltaCents=None)
                row_id = uid()
                self.db.execute('''INSERT INTO profit_results VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                                (row_id, run_id, *key[:3], metric, int(valid), result['profitCents'],
                                 result['totalCostCents'], baseline['latest_id'] if baseline else None,
                                 baseline['anchor_id'] if baseline else None, flags['previousDeltaCents'],
                                 flags['anchorDeltaCents'], int(flags['loss']), int(flags['change']),
                                 int(flags['recovered']), result['reason'], dumps(details), now()))
                if valid:
                    anchor_id = row_id if not baseline or flags['change'] else baseline['anchor_id']
                    anchor_cents = result['profitCents'] if not baseline or flags['change'] else baseline['anchor_cents']
                    self.db.execute('''INSERT INTO profit_baselines VALUES(?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(workspace,shop_id,config_id,metric,source,formula)
                        DO UPDATE SET latest_id=excluded.latest_id,anchor_id=excluded.anchor_id,
                        anchor_cents=excluded.anchor_cents,was_loss=excluded.was_loss''',
                        (*key, row_id, anchor_id, anchor_cents, int(flags['loss'])))
            self.db.execute("UPDATE profit_runs SET status='completed',finished_at=? WHERE id=?", (now(), run_id))

    def fail(self, run_id, error):
        with self.transaction():
            self.db.execute("UPDATE profit_runs SET status='failed',finished_at=?,error=? WHERE id=? AND status='running'",
                            (now(), str(error)[:200], run_id))

    def get(self, run_id):
        run = self.db.execute('SELECT * FROM profit_runs WHERE id=?', (run_id,)).fetchone()
        if not run:
            return None
        rows = self.db.execute('''SELECT r.*,s.content,s.content_hash FROM profit_results r
            JOIN profit_snapshots s ON s.run_id=r.run_id AND s.shop_id=r.shop_id AND s.config_id=r.config_id
            WHERE r.run_id=? ORDER BY r.shop_id,r.config_id,r.metric''', (run_id,)).fetchall()
        return dict(run=dict(run), results=[{**dict(row), 'snapshot': json.loads(row['content']),
                                             'details': json.loads(row['details'])} for row in rows])

    def history(self, workspace):
        return [dict(row) for row in self.db.execute('SELECT * FROM profit_runs WHERE workspace=? ORDER BY started_at DESC LIMIT 50', (workspace,))]

    def reset_anchor(self, workspace, shop_id, config_id, metric, expected_result_id):
        with self.transaction():
            row = self.db.execute('''SELECT * FROM profit_baselines WHERE workspace=? AND shop_id=? AND config_id=?
                AND metric=? AND source='manual' AND formula=?''', (workspace, shop_id, config_id, metric, FORMULA_VERSION)).fetchone()
            if not row or row['latest_id'] != expected_result_id:
                return False
            result = self.db.execute('SELECT profit_cents FROM profit_results WHERE id=?', (row['latest_id'],)).fetchone()
            self.db.execute('''UPDATE profit_baselines SET anchor_id=latest_id,anchor_cents=? WHERE
                workspace=? AND shop_id=? AND config_id=? AND metric=? AND source='manual' AND formula=?''',
                (result[0], workspace, shop_id, config_id, metric, FORMULA_VERSION))
            return True
