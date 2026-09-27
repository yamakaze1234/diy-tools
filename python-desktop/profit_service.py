"""Manual profit jobs: snapshot under lock, read SQL outside the write lock."""
import copy
import re
import threading
from common import AppError, digest, dumps, now, atomic
from profit_rules import business_snapshot, calculate
from profit_store import ProfitStore
from sql_service import normalize


def normalize_link_terms(items, configs):
    """Mirror productInstallment() across every active config in a link."""
    by_link = {}
    for config in configs:
        if config.get('deletedAt'):
            continue
        key = (config.get('shopId'), str(config.get('productId') or ''))
        try:
            term = int(config.get('installment', 0))
        except (TypeError, ValueError):
            term = None
        by_link.setdefault(key, set()).add(term)
    for snapshot in items:
        terms = by_link.get((snapshot['shopId'], snapshot['productId']), set())
        if len(terms) != 1 or next(iter(terms)) not in (0, 12, 24):
            snapshot['feeCents'] = None
    return items


class ProfitService:
    def __init__(self, service):
        self.service = service
        self.store = ProfitStore(service.store.db)
        self.active = None
        self.active_scope = None
        self.active_shop = None
        self.active_ids = None
        self.phase = 'idle'
        self.failure = None
        self.publish_error = None
        self.published_at = None

    def publish_status(self):
        row = self.store.db.execute("SELECT value FROM profit_settings WHERE key='publish'").fetchone()
        setting = __import__('json').loads(row[0]) if row else dict(enabled=False, directory='')
        return dict(**setting, error=self.publish_error, publishedAt=self.published_at)

    def set_publish(self, data):
        directory = data.get('directory')
        enabled = data.get('enabled')
        if type(enabled) is not bool or not isinstance(directory, str) or len(directory) > 1000:
            raise AppError('联动设置无效')
        target = __import__('pathlib').Path(directory) if directory else None
        if enabled and (not target or not target.is_absolute() or not target.is_dir()):
            raise AppError('请选择已存在的绝对目录')
        with self.service.lock:
            value = dict(enabled=enabled, directory=str(target) if target else '')
            with self.store.transaction():
                self.store.db.execute("INSERT INTO profit_settings VALUES('publish',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (dumps(value),))
            if enabled:
                self.publish()
            return self.publish_status()

    def publish(self):
        setting = self.publish_status()
        if not setting['enabled']:
            return setting
        service = self.service
        try:
            configs = [c for c in service.state.get('configs', []) if not c.get('deletedAt') and not c.get('emptyLinkDraft') and c.get('productCategory') != '主机模板']
            if len(configs) > 5000:
                raise ValueError('配置超过联动上限')
            items = normalize_link_terms([business_snapshot(c) for c in configs], service.state.get('configs', []))
            ids = [(c['shopId'], c['configId']) for c in items]
            if len(set(ids)) != len(ids):
                raise ValueError('配置身份重复')
            manifest = dict(contract='profit-monitor/v1', schemaVersion=1, complete=True,
                            sourceId=service.store.meta('deviceId'), workspaceId=service.scope(),
                            revision=service.state['revision'], publishedAt=now(),
                            formulaVersion=__import__('profit_rules').FORMULA_VERSION,
                            businessHash=digest(dumps(items)), configs=items)
            manifest['contentHash'] = digest(dumps(manifest))
            raw = dumps(manifest)
            if len(raw.encode('utf-8')) > 20_000_000:
                raise ValueError('联动快照超过大小上限')
            target = __import__('pathlib').Path(setting['directory']) / 'profit-monitor' / 'manifest.json'
            atomic(target, raw)
            self.publish_error = None
            self.published_at = manifest['publishedAt']
        except Exception:
            self.publish_error = '联动尚未更新，请检查目录并重试'
        return self.publish_status()

    def start(self, data, cookie):
        service = self.service
        request_id = data.get('requestId')
        shop_id = data.get('shopId')
        selected = data.get('configIds')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9-]{8,100}', request_id):
            raise AppError('检测请求 ID 无效')
        if shop_id not in ('intel', 'gigabyte', 'jonsbo'):
            raise AppError('店铺无效')
        if selected is not None and (not isinstance(selected, list) or len(selected) > 1000 or any(not isinstance(x, str) for x in selected) or len(set(selected)) != len(selected)):
            raise AppError('配置范围无效')
        with service.lock:
            service.cloud.require_login(cookie)
            selected_set = set(selected) if selected is not None else None
            configs = [c for c in service.state.get('configs', []) if c.get('shopId') == shop_id and not c.get('deletedAt') and not c.get('emptyLinkDraft') and c.get('productCategory') != '主机模板' and (selected_set is None or c.get('id') in selected_set)]
            if selected_set is not None and {c['id'] for c in configs} != selected_set:
                raise AppError('所选配置已变化，请重新选择', 409)
            if not configs or len(configs) > 1000:
                raise AppError('本店没有可检测配置或超过 1000 套')
            if self.active:
                if (self.active_scope, self.active_shop, self.active_ids) != (service.scope(), shop_id, frozenset(c['id'] for c in configs)):
                    raise AppError('已有其他范围的利润检测正在运行，请完成后再检测', 409)
                return dict(runId=self.active, phase=self.phase, repeated=True)
            snapshots = normalize_link_terms([business_snapshot(c) for c in copy.deepcopy(configs)], service.state.get('configs', []))
            hashes = {s['configId']: digest(dumps(s)) for s in snapshots}
            run_id, created = self.store.start(request_id, service.scope(), service.state['revision'], snapshots, hashes)
            if not created:
                return dict(runId=run_id, phase='existing', repeated=True)
            self.active, self.active_scope, self.active_shop = run_id, service.scope(), shop_id
            self.active_ids = frozenset(c['id'] for c in configs)
            self.phase, self.failure = 'collecting', None
            owner = service.cloud.owner(cookie)
            worker = threading.Thread(target=self._run, args=(run_id, snapshots, owner), daemon=True, name='profit-manual')
            worker.start()
            return dict(runId=run_id, phase=self.phase, repeated=False)

    def _run(self, run_id, snapshots, owner):
        service = self.service
        costs, sql_error, cost_at = {}, None, None
        try:
            try:
                with service.lock:
                    credential = service.credentials.read(owner)
                if not credential['saved']:
                    sql_error = '尚未保存 SQL 只读连接；本轮仍检测核算利润'
                else:
                    wanted = {p['goodsId'] for s in snapshots for p in s['parts'] if re.fullmatch(r'[1-9]\d{0,19}', p['goodsId'])}
                    collected = service.profit_cost_reader(credential['settings'], credential['password'], wanted)
                    costs, cost_at = collected['costs'], collected['collectedAt']
            except Exception:
                sql_error = 'ERP 成本采集失败；本轮仍检测核算利润'
            with service.lock:
                self.phase = 'calculating'
            observations = []
            for snapshot in snapshots:
                for metric in ('erp', 'accounting'):
                    result = calculate(snapshot, costs, metric)
                    if metric == 'erp' and sql_error:
                        result = dict(valid=False, reason=sql_error, profitCents=None, totalCostCents=None)
                    details = dict(costAt=cost_at if metric == 'erp' else max((p.get('taxUpdatedAt') or '' for p in snapshot['parts']), default='') or None,
                                   source='company-sql' if metric == 'erp' else 'saved-tax',
                                   parts=[{**p, 'unitCostCents': costs.get(p['goodsId']) if metric == 'erp' else p['taxCents']} for p in snapshot['parts']])
                    observations.append((snapshot, metric, result, details))
            with service.lock:
                self.store.finish(run_id, observations)
                self.phase = 'completed'
        except Exception:
            with service.lock:
                self.store.fail(run_id, '检测内部错误，请查看本机日志')
                self.phase, self.failure = 'failed', '检测内部错误'
        finally:
            with service.lock:
                self.active = None
                self.active_scope = self.active_shop = self.active_ids = None

    def status(self, run_id):
        with self.service.lock:
            result = self.store.get(run_id)
            if result is None:
                raise AppError('检测任务不存在', 404)
            if result['run']['workspace'] != self.service.scope():
                raise AppError('检测任务不属于当前工作区', 404)
            current = {c['id']: c for c in self.service.state.get('configs', [])}
            for row in result['results']:
                live = current.get(row['config_id'])
                candidate = business_snapshot(live) if live is not None else None
                if candidate and row['snapshot']['feeCents'] is None:
                    peers = [c for c in current.values() if not c.get('deletedAt') and str(c.get('productId') or '') == candidate['productId'] and c.get('shopId') == candidate['shopId']]
                    try:
                        terms = {int(c.get('installment', 0)) for c in peers}
                    except (TypeError, ValueError):
                        terms = {None}
                    if len(terms) != 1 or next(iter(terms)) not in (0, 12, 24):
                        candidate['feeCents'] = None
                row['configUpdated'] = live is None or live.get('deletedAt') is not None or digest(dumps(candidate)) != row['content_hash']
            result['phase'] = self.phase if self.active == run_id else result['run']['status']
            return result

    def history(self):
        with self.service.lock:
            return self.store.history(self.service.scope())

    def reset(self, data):
        if data.get('metric') not in ('erp', 'accounting') or not isinstance(data.get('configId'), str) or not isinstance(data.get('resultId'), str) or data.get('shopId') not in ('intel', 'gigabyte', 'jonsbo'):
            raise AppError('基准身份无效')
        with self.service.lock:
            return self.store.reset_anchor(self.service.scope(), data['shopId'], data['configId'], data['metric'], data['resultId'])
