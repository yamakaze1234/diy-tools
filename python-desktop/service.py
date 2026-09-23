"""Application services. One lock serializes commits; network reads release it."""
import copy
import json
import math
import re
import sqlite3
import threading
import time
import getpass
from pathlib import Path
from common import AppError, atomic, digest, dumps, now, uid
from domain import Domain
from store import Store, History, LOCAL_FIELDS
from cloud import Cloud
from credentials import Credentials
from sql_service import settings, normalize, read_bundle
from product_jobs import ProductJobs


class Service:
    def __init__(self, root, local, transport=None, sql_reader=None):
        self.root, self.local = Path(root), Path(local)
        self.lock = threading.RLock()
        self.local.mkdir(parents=True, exist_ok=True)
        for name in ('assets', 'images'):
            (self.local / name).mkdir(exist_ok=True)
        self.backup_upgrade()
        self.domain = Domain(self.root)
        self.product_jobs = ProductJobs(lambda value: self.domain('parseStandardProduct', value))
        self.config = None
        for line in (self.root / 'web' / '.env.local').read_text(encoding='utf-8').splitlines():
            if line.startswith('CLOUDBASE_PUBLIC_CONFIG='):
                self.config = json.loads(line.split('=', 1)[1])
        self.catalog = json.loads((self.root / 'web' / 'catalog.json').read_text(encoding='utf-8'))
        file = self.local / 'state.json'
        raw = json.loads((file if file.exists() else self.root / 'web' / 'seed.json').read_text(encoding='utf-8-sig'))
        self.state = self.domain('normalizeWorkspaceState', raw, self.catalog)
        self.store = Store(self.local / 'workspace.sqlite', self.domain)
        if self.store.meta('enabled') and self.store.meta('workspaceState'):
            self.state = self.domain('normalizeWorkspaceState', self.store.meta('workspaceState'), self.catalog)
        self.state['logs'] = self.domain('recentActivity', self.state.get('logs', []))
        self.state.setdefault('revision', 0)
        self.history = History(self.local / 'versions.sqlite', self.domain)
        self.history_timer = None
        self.maintenance_timer = None
        self.history_pending = False
        self.history_started = None
        self.history_error = None
        self.credentials = Credentials(self.local)
        self.session = dict(id=uid(), startedAt=now(), defaultOperator=getpass.getuser())
        self.previews = {}
        self.sql_reader = sql_reader or read_bundle
        atomic(file, dumps(self.state))
        try:
            self.history.record(self.state, self.scope(), '启动 Python 工作台')
        except (AppError, sqlite3.Error, OSError) as error:
            self.history_error = str(error)
        self.cloud = Cloud(self, transport)
        self.save_standard_products(self.state)
        self.schedule_maintenance(60)

    def save_standard_products(self, state):
        """Business JSON stays independent of poster settings; index gates future matching."""
        products = self.domain('standardProducts', state)
        directory = self.local / 'products-standard'
        directory.mkdir(exist_ok=True)
        entries = []
        for product in products:
            filename = digest(dumps([product['shopId'], product['productId']]))[:24] + '.json'
            raw = dumps(product['data'])
            atomic(directory / filename, raw)
            entries.append({**{k: v for k, v in product.items() if k != 'data'}, 'file': filename, 'sha256': digest(raw)})
        index = dict(format=1, contract='CoreHub/pypkgs#13', revision=state.get('revision', 0), sourceHash=digest(dumps(state)), links=entries)
        atomic(directory / 'index.json', dumps(index))
        return index

    def backup_upgrade(self):
        marker = self.local / 'python-backend-migration.json'
        if marker.exists() or not any((self.local / name).exists() for name in ('state.json', 'workspace.sqlite', 'versions.sqlite')):
            return
        target = self.local / 'backups' / ('before-python-' + uid())
        target.mkdir(parents=True)
        for name in ('workspace.sqlite', 'versions.sqlite'):
            source = self.local / name
            if source.exists():
                reader = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
                writer = sqlite3.connect(target / name)
                try:
                    reader.backup(writer)
                finally:
                    writer.close()
                    reader.close()
        if (self.local / 'state.json').exists():
            atomic(target / 'state.json', (self.local / 'state.json').read_bytes())
        atomic(marker, dumps(dict(version=1, at=now(), backup=str(target))))

    def scope(self):
        return self.store.meta('workspaceId') or 'local'

    def save(self, value, reason):
        value['logs'] = self.domain('recentActivity', value.get('logs', []))
        important = any(word in reason for word in ('导入', '批量', '还原', '应用 SQL', '应用 ERP'))
        if important:
            self.flush_history()
        if not self.history_pending:
            self.record_history(self.state, '修改前自动备份')
        atomic(self.local / 'state.json', dumps(value))
        if not self.cloud.enabled():
            changes = self.domain('changesBetween', self.state, value)
            with self.store.transaction():
                self.store.log_local([dict(type=c['type'], id=c['id'], before=c.get('expectedDraft'), after=c['data']) for c in changes], self.cloud.audit_actor())
        self.state = value
        if important:
            self.record_history(value, reason)
        else:
            self.history_pending = True
            self.history_started = self.history_started or time.monotonic()
            self.schedule_history()
        self.save_standard_products(value)

    def record_history(self, state, reason):
        try:
            self.history.record(state, self.scope(), reason)
            self.history_error = None
        except (AppError, sqlite3.Error, OSError) as error:
            self.history_error = str(error)

    def schedule_history(self):
        if self.history_timer:
            self.history_timer.cancel()
        delay = min(120, max(0, 600 - (time.monotonic() - self.history_started)))
        self.history_timer = threading.Timer(delay, self.flush_history)
        self.history_timer.daemon = True
        self.history_timer.start()

    def flush_history(self):
        with self.lock:
            if self.history_timer:
                self.history_timer.cancel()
                self.history_timer = None
            if self.history_pending:
                self.record_history(self.state, '连续编辑自动版本')
                self.history_pending = False
                self.history_started = None

    def schedule_maintenance(self, delay):
        self.maintenance_timer = threading.Timer(delay, self.maintain_history)
        self.maintenance_timer.daemon = True
        self.maintenance_timer.start()

    def maintain_history(self):
        with self.lock:
            if self.history_pending:
                self.schedule_maintenance(180)
                return
            try:
                self.history.prune()
            except (sqlite3.Error, OSError, AppError) as error:
                self.history_error = str(error)
            self.schedule_maintenance(24 * 60 * 60)

    def actor(self, value):
        return str(value or self.session['defaultOperator']).strip()[:60] or self.session['defaultOperator']

    def update_state(self, incoming, cookie):
        with self.lock:
            self.cloud.require_login(cookie)
            state = self.state
            if incoming.get('baseRevision') != state['revision']:
                base = incoming.get('baseState')
                if not isinstance(base, dict):
                    raise AppError('其他页面已经保存更新，请先下载当前草稿，再重新载入。', 409)
                merged = self.domain('mergeEditingState', base, incoming, state)
                if merged['conflict']:
                    raise AppError('同一字段已被修改，当前草稿已保留，请比较后选择保存版本。', 409)
                incoming = {**incoming, **{k: merged['state'][k] for k in ('configs', 'templates', 'sourceCatalog', 'costSource', 'caseGallery', 'shopSettings')}, 'baseState': state}

            configs, templates = incoming.get('configs'), incoming.get('templates')
            if not isinstance(configs, list) or (not configs and state.get('configs')) or not isinstance(templates, list):
                raise AppError('配置数据格式不正确')
            self.domain('validateConfigCapacity', configs)
            shop_ids = {'intel', 'gigabyte', 'jonsbo'}
            numeric = lambda v: type(v) in (int, float) and math.isfinite(v) and v >= 0
            if 'caseGallery' in incoming:
                self.domain('validateGallery', incoming['caseGallery'])
            for field, maximum in [('sourceCatalog', 30000), ('costSource', 100000)]:
                if field not in incoming:
                    continue
                rows = incoming[field]
                if not isinstance(rows, list) or len(rows) > maximum:
                    raise AppError('输出源或成本源格式不正确')
                seen = set()
                for row in rows:
                    if not isinstance(row, dict) or not isinstance(row.get('goodsId'), str) or (row.get('tax') is not None and not numeric(row['tax'])):
                        raise AppError('输出源或成本源格式不正确')
                    key = row.get('sourceId') if field == 'sourceCatalog' else row['goodsId']
                    if not isinstance(key, str) or key in seen:
                        raise AppError('输出源或成本源 ID 无效或重复')
                    seen.add(key)
                    if field == 'sourceCatalog':
                        if row.get('shopId') not in shop_ids or not isinstance(row.get('name'), str):
                            raise AppError('输出源格式不正确')
                    elif not re.fullmatch(r'\d{1,20}', key):
                        raise AppError('成本源格式不正确')
            if 'shopSettings' in incoming:
                value = incoming['shopSettings']
                if not isinstance(value, dict) or any(not isinstance(value.get(k), dict) or not numeric(value[k].get('coupon')) for k in shop_ids):
                    raise AppError('店铺优惠券金额无效')
                if any('serviceText' in value[k] and (not isinstance(value[k]['serviceText'], str) or len(value[k]['serviceText']) > 1000) for k in shop_ids):
                    raise AppError('默认服务承诺无效')
                for entry in value.values():
                    if 'erpShopId' in entry and (not isinstance(entry['erpShopId'], str) or entry['erpShopId'] and not re.fullmatch(r'\d{1,30}', entry['erpShopId'])):
                        raise AppError('ERP 店铺 ID 无效')
                    if 'erpShopName' in entry and (not isinstance(entry['erpShopName'], str) or len(entry['erpShopName']) > 200):
                        raise AppError('ERP 店铺名称无效')
            for config in configs:
                if not isinstance(config, dict) or config.get('shopId') not in shop_ids or config.get('installment', 0) not in (0, 12, 24) or not isinstance(config.get('addons'), list) or not isinstance(config.get('parts'), list) or ('actualParts' in config and not isinstance(config['actualParts'], list)):
                    raise AppError('配置店铺、配件、分期或加购格式无效')
            self.domain('validateSaveAddons', incoming.get('sourceCatalog', []),
                        [addon for config in configs for addon in config['addons']])
            next_state = copy.deepcopy(state)
            for key in ('configs', 'templates', 'sourceCatalog', 'costSource', 'caseGallery', 'shopSettings'):
                if key in incoming:
                    next_state[key] = copy.deepcopy(incoming[key])
            existing = {c['id']: c for c in state.get('configs', [])}
            for config in next_state['configs']:
                if config.get('deletedAt'):
                    old = existing.get(config['id'], {})
                    config['deletionSessionId'] = old.get('deletionSessionId') if old.get('deletedAt') else self.session['id']
                else:
                    config.pop('deletionSessionId', None)
            next_state.update(revision=state['revision'] + 1, updatedAt=now())
            next_state = self.domain('normalizeWorkspaceState', next_state, self.catalog)
            message = str(incoming.get('message') or '保存配置')[:160]
            operator = (self.cloud.member or {}).get('name') or self.actor(incoming.get('operator'))
            events = [self.domain('activityEntry', c['type'], c['id'], c.get('expectedDraft'), c['data'], dict(operator=operator, message=message)) for c in self.domain('changesBetween', state, next_state)]
            next_state['logs'] = self.domain('recentActivity', [e for e in events if e] + state.get('logs', []))
            next_state = self.cloud.persist(state, next_state, incoming.get('baseState', state))
            self.save(next_state, message)
            return dict(revision=self.state['revision'], updatedAt=self.state['updatedAt'], logs=self.state['logs'], state=self.state)

    def sql_preview(self, data, cookie):
        config = settings(data.get('settings'))
        scope = digest(dict(server=config['server'].lower(), port=config['port'], database=config['database'].lower()))
        with self.lock:
            owner = self.cloud.owner(cookie)
            epoch = self.cloud.epoch
            self.check_sql_scope(scope)
        if data.get('remember') is True:
            self.credentials.save(owner, config, data.get('password'))
        elif data.get('remember') is False:
            self.credentials.clear(owner)
        rows = normalize(self.sql_reader(config, data.get('password')))
        data['password'] = ''
        with self.lock:
            if self.cloud.owner(cookie) != owner or self.cloud.epoch != epoch:
                raise AppError('登录身份已变化，请重新读取')
            self.check_sql_scope(scope)
            plan = self.domain('sqlStockPlan', self.state, rows)
            key, expires = uid(), int(time.time() * 1000) + 600000
            self.previews = {k: p for k, p in self.previews.items() if p['expiresAt'] > time.time() * 1000 and p['owner'] != owner}
            if len(self.previews) >= 20:
                self.previews.pop(next(iter(self.previews)))
            self.previews[key] = dict(owner=owner, cookie=cookie, epoch=epoch, rows=rows, base=digest(self.state), expiresAt=expires, scope=scope, operator=self.actor(data.get('operator')))
            return dict(id=key, expiresAt=expires, source={k: config[k] for k in ('server', 'port', 'database')}, **{k: plan[k] for k in ('total', 'matched', 'unmatched', 'unknown', 'changes', 'configIds')})

    def check_sql_scope(self, scope):
        bound = ((self.state.get('erpSync') or {}).get('sqlSync') or {}).get('scope')
        if bound and bound != scope:
            raise AppError('SQL 数据库与上次同步不同，请连接原服务器和数据库')

    def sql_apply(self, key, cookie):
        with self.lock:
            pending = self.previews.get(key)
            owner = self.cloud.owner(cookie)
            if not pending or pending['owner'] != owner or pending['cookie'] != cookie or pending['epoch'] != self.cloud.epoch or pending['expiresAt'] <= time.time() * 1000:
                raise AppError('预览已失效，请重新读取')
            if pending['base'] != digest(self.state):
                raise AppError('配置数据已变化，请重新预览')
            at = now()
            plan = self.domain('sqlStockPlan', self.state, pending['rows'], at)
            summary = dict(updatedAt=at, scope=pending['scope'], warehouse='公司大库', stockField='分库可销数', costField='库存成本', **{k: plan[k] for k in ('total', 'matched', 'unmatched', 'unknown')})
            next_state = plan['next']
            previous = self.state.get('erpSync') or {}
            next_state['erpSync'] = {**previous, 'scope': previous.get('scope') or 'sql:' + pending['scope'], 'stockSource': 'company-sql', 'stockUpdatedAt': at, 'updatedAt': at, 'costField': '库存成本', 'sqlSync': summary}
            next_state.update(sqlSync=summary, revision=self.state['revision'] + 1, updatedAt=at)
            next_state['logs'] = [dict(at=at, operator=pending['operator'], message=f"同步 SQL 公司大库：{plan['total']} 件商品，本机更新 ERP 成本与可销数，保留人工价")] + self.state.get('logs', [])
            next_state = self.cloud.persist(self.state, next_state)
            self.save(next_state, '应用 SQL 库存与成本')
            del self.previews[key]
            return dict(ok=True, **summary, configIds=plan['configIds'], revision=next_state['revision'])

    def restore_target(self, key):
        archived = self.history.get(key, self.scope())['state']
        next_state = copy.deepcopy(self.state)
        for field in ('configs', 'templates', 'sourceCatalog', 'caseGallery', 'shopSettings'):
            if field in archived:
                next_state[field] = copy.deepcopy(archived[field])
        # ERP fields are local, time-sensitive observations. Copying an old
        # configuration's layout must not roll its inventory or cost back.
        def scrub_local(value):
            if isinstance(value, dict):
                for field in LOCAL_FIELDS:
                    value.pop(field, None)
                for child in value.values():
                    scrub_local(child)
            elif isinstance(value, list):
                for child in value:
                    scrub_local(child)

        def preserve_local(old, current):
            if isinstance(old, dict) and isinstance(current, dict):
                if old.get('goodsId') and current.get('goodsId') and old['goodsId'] != current['goodsId']:
                    scrub_local(old)
                    return
                for field in LOCAL_FIELDS:
                    if field in current:
                        old[field] = copy.deepcopy(current[field])
                    else:
                        old.pop(field, None)
                for field, value in old.items():
                    if field in current:
                        preserve_local(value, current[field])
                    else:
                        scrub_local(value)
            elif isinstance(old, list) and isinstance(current, list):
                for field in ('id', 'lineId', 'sourceId', 'goodsId', 'slot'):
                    if old and current and all(isinstance(item, dict) and item.get(field) is not None for item in old + current):
                        existing = {item[field]: item for item in current}
                        for item in old:
                            if item[field] in existing:
                                preserve_local(item, existing[item[field]])
                            else:
                                scrub_local(item)
                        return
                scrub_local(old)
            else:
                scrub_local(old)

        preserve_local(next_state['configs'], self.state.get('configs', []))
        preserve_local(next_state['sourceCatalog'], self.state.get('sourceCatalog', []))
        return next_state

    def preview_version(self, key):
        return self.history.preview(key, self.scope(), self.state, self.restore_target(key))

    def restore(self, data, cookie):
        with self.lock:
            self.cloud.require_login(cookie)
            status = self.cloud.status()
            if any(status[k] for k in ('running', 'uncertain', 'conflicts')):
                raise AppError('请等待同步结束并处理冲突或未确认提交，再还原版本')
            preview = self.preview_version(data.get('id'))
            if data.get('baseRevision') != self.state['revision'] or data.get('hash') != preview['hash']:
                raise AppError('当前数据或历史版本已变化，请重新预览')
            self.flush_history()
            if self.history_error:
                raise AppError('恢复前未能保存当前版本：' + self.history_error)
            next_state = self.restore_target(data['id'])
            next_state.update(revision=self.state['revision'] + 1, updatedAt=now(), logs=[dict(at=now(), operator=self.actor((self.cloud.member or {}).get('name')), message=f"还原历史版本 {preview['revision']}")] + self.state.get('logs', []))
            next_state = self.domain('normalizeWorkspaceState', next_state, self.catalog)
            next_state = self.cloud.persist(self.state, next_state)
            self.save(next_state, '还原历史版本')
            return dict(revision=next_state['revision'])

    def collector(self, action, data):
        with self.lock:
            if not self.cloud.token:
                raise AppError('请先登录工作台成员账号', 401)
            if action.startswith('product-'):
                if time.time() >= self.cloud.expires or self.cloud.auth_changing:
                    raise AppError('工作台登录已过期或正在切换账号', 401)
                self.product_jobs.session(self.cloud.cookie)
                return self.product_jobs.collect(action[len('product-'):], data)
            info = self.state.get('erpSync')
            if action != 'snapshot':
                return self.domain('erpJob', {'error': 'fail'}.get(action, action), data, info)
            job = self.domain('erpJob', 'verify', data, info)
            rows = self.domain('validateSnapshot', data)
            at = now()
            plan = self.domain('mergeErp', self.state, rows, self.catalog, at)
            next_state = plan['next']
            next_state.update(revision=self.state['revision'] + 1, updatedAt=at)
            next_state['erpSync'] = {**(info or {}), 'scope': (info or {}).get('scope') or job['scope'], 'browserScope': job['scope'], 'stockSource': 'browser-script', 'stockUpdatedAt': at, 'account': data['account'], 'warehouse': data['warehouse'], 'depotId': data['depotId'], 'updatedAt': at, 'total': len(rows), 'costField': data.get('costField'), **{k: plan[k] for k in ('excluded', 'matched', 'unmatched')}}
            next_state['logs'] = [dict(at=at, operator=self.actor(job.get('operator')), message=f'同步脚本库存与 ERP 成本：{len(rows)} 条')] + self.state.get('logs', [])
            self.save(self.cloud.persist(self.state, next_state), '应用 ERP 库存与成本')
            self.domain('erpJob', 'complete', {**self.state['erpSync'], 'configIds': plan['configIds'], 'revision': self.state['revision']}, info)
            return dict(ok=True, revision=self.state['revision'])

    def close(self):
        self.cloud.close()
        with self.lock:
            if self.maintenance_timer:
                self.maintenance_timer.cancel()
            self.flush_history()
            self.history.close()
            self.store.close()
            self.domain.close()
