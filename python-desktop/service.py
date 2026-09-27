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
from sql_service import settings, normalize, read_bundle, read_costs, read_product
from product_jobs import ProductJobs
from profit_service import ProfitService
from backup_retention import prune_backups


class Service:
    def __init__(self, root, local, transport=None, sql_reader=None, profit_cost_reader=None):
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
        if self.store.meta('workspaceState') and (self.store.meta('enabled') or (self.store.meta('localWorkspaceRevision') or -1) >= raw.get('revision', 0)):
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
        self.profit_cost_reader = profit_cost_reader or read_costs
        self.profit = ProfitService(self)
        atomic(file, dumps(self.state))
        try:
            prune_backups(self.local, self.store)
            self.history.record(self.state, self.scope(), '启动 Python 工作台')
        except (AppError, sqlite3.Error, OSError, RuntimeError) as error:
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
            target = directory / filename
            if not target.exists() or target.read_bytes() != raw.encode('utf-8'):
                atomic(target, raw)
            entries.append({**{k: v for k, v in product.items() if k != 'data'}, 'file': filename, 'sha256': digest(raw)})
        index = dict(format=1, contract='CoreHub/pypkgs#13', revision=state.get('revision', 0), sourceHash=digest(dumps(state)), links=entries)
        atomic(directory / 'index.json', dumps(index))
        return index

    @staticmethod
    def product_key(config):
        return (config.get('shopId'), config.get('productId') or 'legacy:' + str(config.get('spu') or config.get('product') or config.get('id')))

    def affected_products(self, before, after):
        old = {c['id']: c for c in before.get('configs', [])}
        new = {c['id']: c for c in after.get('configs', [])}
        links = set()
        for key in old.keys() | new.keys():
            previous, current = old.get(key), new.get(key)
            if previous == current:
                continue
            if previous:
                links.add(self.product_key(previous))
            if current:
                links.add(self.product_key(current))
        shops = {shop for shop in set(before.get('shopSettings', {})) | set(after.get('shopSettings', {}))
                 if before.get('shopSettings', {}).get(shop) != after.get('shopSettings', {}).get(shop)}
        if shops:
            links.update(self.product_key(c) for c in after.get('configs', []) if c.get('shopId') in shops)
        old_cost = {c['goodsId']: c for c in before.get('costSource', [])}
        new_cost = {c['goodsId']: c for c in after.get('costSource', [])}
        changed_cost = {key for key in old_cost.keys() | new_cost.keys() if old_cost.get(key) != new_cost.get(key)}
        if changed_cost:
            links.update(self.product_key(c) for c in after.get('configs', [])
                         if any(p.get('goodsId') in changed_cost for p in c.get('actualParts', c.get('parts', []))))
        return links

    def save_affected_products(self, before, after):
        """Update only affected link documents; index remains the commit marker."""
        directory = self.local / 'products-standard'
        index_file = directory / 'index.json'
        if not index_file.exists():
            return self.save_standard_products(after)
        old_index = json.loads(index_file.read_text(encoding='utf-8'))
        # A previous save may have committed SQLite/state while a derived file
        # write failed. Never certify the old index as the new revision.
        if old_index.get('revision') != before.get('revision') or old_index.get('sourceHash') != digest(dumps(before)):
            return self.save_standard_products(after)
        links = self.affected_products(before, after)
        if not links:
            index = {**old_index, 'revision': after['revision'], 'sourceHash': digest(dumps(after))}
            atomic(index_file, dumps(index))
            return index
        targets = [c for c in after.get('configs', []) if self.product_key(c) in links]
        goods = {p.get('goodsId') for c in targets for p in c.get('actualParts', c.get('parts', []))}
        context = dict(configs=targets, costSource=[c for c in after.get('costSource', []) if c.get('goodsId') in goods],
                       shopSettings=after.get('shopSettings', {}))
        products = self.domain('standardProducts', context)
        entries = [entry for entry in old_index.get('links', []) if (entry['shopId'], entry['productId']) not in links]
        for product in products:
            filename = digest(dumps([product['shopId'], product['productId']]))[:24] + '.json'
            raw = dumps(product['data'])
            target = directory / filename
            if not target.exists() or target.read_bytes() != raw.encode('utf-8'):
                atomic(target, raw)
            entries.append({**{k: v for k, v in product.items() if k != 'data'}, 'file': filename, 'sha256': digest(raw)})
        entries.sort(key=lambda r: (r['shopId'], r['productId']))
        index = dict(format=1, contract='CoreHub/pypkgs#13', revision=after['revision'],
                     sourceHash=digest(dumps(after)), links=entries)
        atomic(index_file, dumps(index))
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

    def save(self, value, reason, changes=None):
        value['logs'] = self.domain('recentActivity', value.get('logs', []))
        important = any(word in reason for word in ('导入', '批量', '还原', '应用 SQL', '应用 ERP'))
        if important:
            self.flush_history()
        if not self.history_pending:
            self.record_history(self.state, '修改前自动备份')
        if not self.cloud.enabled():
            changes = changes if changes is not None else self.prepare_workspace_changes(self.state, value)
            self.store.edit_many(changes, state=value, actor=self.cloud.audit_actor(), replace=True)
        previous = self.state
        self.state = value
        atomic(self.local / 'state.json', dumps(value))
        if important:
            self.record_history(value, reason)
        else:
            self.history_pending = True
            self.history_started = self.history_started or time.monotonic()
            self.schedule_history()
        self.save_affected_products(previous, value)
        self.profit.publish()

    def record_history(self, state, reason):
        try:
            self.history.record(state, self.scope(), reason)
            self.history_error = None
        except (AppError, sqlite3.Error, OSError, RuntimeError) as error:
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
            try:
                self.history.prune()
                prune_backups(self.local, self.store)
            except (sqlite3.Error, OSError, AppError, RuntimeError) as error:
                self.history_error = str(error)
            self.schedule_maintenance(60)

    def actor(self, value):
        return str(value or self.session['defaultOperator']).strip()[:60] or self.session['defaultOperator']

    def merge_editing_state(self, base, local, remote):
        # Only editor-owned fields participate in the three-way merge. Requests
        # carry baseState as well; serializing it again plus activity logs can
        # exhaust the embedded JS heap on a real multi-shop workspace.
        fields = ('configs', 'templates', 'sourceCatalog', 'costSource', 'caseGallery', 'shopSettings')
        result, pending = {}, []
        for key in fields:
            fallback = {} if key == 'shopSettings' else []
            before, edited, latest = (value.get(key, fallback) for value in (base, local, remote))
            if edited == before:
                result[key] = latest
            elif latest == before or edited == latest:
                result[key] = edited
            else:
                pending.append(key)
        conflict = False
        if pending:
            projected = [{key: value[key] for key in pending if key in value}
                         for value in (base, local, remote)]
            merged = self.domain('mergeEditingState', *projected)
            conflict = merged['conflict']
            result.update({key: merged['state'][key] for key in pending})
        return dict(state=result, conflict=conflict)

    def prepare_workspace_changes(self, before, after):
        # Activity history is not a workspace record and cannot affect its diff.
        return self.domain('prepareWorkspaceChanges',
                           {key: value for key, value in before.items() if key != 'logs'},
                           {key: value for key, value in after.items() if key != 'logs'})

    def update_state(self, incoming, cookie):
        with self.lock:
            self.cloud.require_login(cookie)
            enabled = self.cloud.enabled()
            if enabled and not self.store.get('workspace_meta', 'root'):
                raise AppError('首次云端数据仍在下载，请稍后编辑')
            state = self.state
            if incoming.get('baseRevision') != state['revision']:
                base = incoming.get('baseState')
                if not isinstance(base, dict):
                    raise AppError('其他页面已经保存更新，请先下载当前草稿，再重新载入。', 409)
                merged = self.merge_editing_state(base, incoming, state)
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
            baseline = incoming.get('baseState', state)
            changes = self.prepare_workspace_changes(baseline, next_state)
            activity = self.domain('batchActivityEntries', changes, dict(operator=operator, message=message), state.get('logs', []))
            next_state['logs'] = activity['logs']
            next_state = self.cloud.persist(state, next_state, baseline, changes)
            self.save(next_state, message, changes if not self.cloud.enabled() and baseline == state else None)
            return dict(revision=self.state['revision'], updatedAt=self.state['updatedAt'], logs=self.state['logs'], state=self.state)

    def update_configs_batch(self, incoming, cookie):
        """Commit a complete batch of existing configuration edits as one unit."""
        with self.lock:
            self.cloud.require_login(cookie)
            enabled = self.cloud.enabled()
            if enabled and not self.store.get('workspace_meta', 'root'):
                raise AppError('首次云端数据仍在下载，请稍后编辑')
            operation = incoming.get('operationId')
            if not isinstance(operation, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', operation):
                raise AppError('批量操作 ID 无效')
            request_hash = digest(incoming)
            replay = self.store.batch_receipt(operation)
            if replay:
                if replay[0] != request_hash:
                    raise AppError('批量操作 ID 已用于其他内容', 409)
                if replay[1].get('expired'):
                    raise AppError('批量操作回执已过期，请重新载入后核对结果', 409)
                atomic(self.local / 'state.json', dumps(self.state))
                self.save_standard_products(self.state)
                return replay[1]
            rows = incoming.get('changes')
            if not isinstance(rows, list) or not 0 < len(rows) <= 1000:
                raise AppError('批量配置数量无效，最多 1000 套')
            if type(incoming.get('baseRevision')) is not int or incoming['baseRevision'] < 0:
                raise AppError('批量基线版本无效')
            ids = [r.get('id') for r in rows if isinstance(r, dict)]
            if len(ids) != len(rows) or any(not isinstance(i, str) or not i or len(i) > 200 for i in ids) or len(set(ids)) != len(ids):
                raise AppError('批量配置 ID 无效或重复')
            current = self.state
            by_id = {c['id']: (index, c) for index, c in enumerate(current['configs'])}
            for row in rows:
                key = row['id']
                if key not in by_id or by_id[key][1].get('deletedAt'):
                    raise AppError('目标配置已删除或不存在，请重新预览', 409)
                base, after = row.get('base'), row.get('after')
                if not isinstance(base, dict) or not isinstance(after, dict) or base.get('id') != key or after.get('id') != key:
                    raise AppError('批量配置基线或结果无效')
                if base.get('deletedAt') or after.get('deletedAt') or base.get('shopId') != after.get('shopId') or base.get('productId') != after.get('productId'):
                    raise AppError('批量操作不可删除或移动配置')
                if not isinstance(after.get('parts'), list) or not isinstance(after.get('addons'), list) or ('actualParts' in after and not isinstance(after['actualParts'], list)):
                    raise AppError('批量配件或加购格式无效')
                allowed = {'parts', 'actualParts', 'addons', 'shortName', 'emptyLinkDraft'}
                if {k: v for k, v in base.items() if k not in allowed} != {k: v for k, v in after.items() if k not in allowed}:
                    raise AppError('批量接口仅能修改展示、实际配件与关联加购')
                if base.get('shopId') != by_id[key][1].get('shopId') or base.get('productId') != by_id[key][1].get('productId'):
                    raise AppError('配置店铺或链接已变化，请重新预览', 409)
            if incoming['baseRevision'] > current['revision']:
                raise AppError('批量基线版本无效', 409)
            rebased = incoming['baseRevision'] != current['revision']
            if rebased:
                baseline = dict(configs=[r['base'] for r in rows], shopSettings={})
                desired = dict(configs=[r['after'] for r in rows], shopSettings={})
                remote = dict(configs=[by_id[r['id']][1] for r in rows], shopSettings={})
                merged = self.merge_editing_state(baseline, desired, remote)
                if merged['conflict']:
                    raise AppError('同一字段已被修改，请重新预览', 409)
                after_by_id = {c['id']: c for c in merged['state']['configs']}
                rows = [{**r, 'after': after_by_id[r['id']]} for r in rows]
            goods = {p.get('goodsId') for row in rows for config in (row['base'], row['after'], by_id[row['id']][1])
                     for field in ('parts', 'actualParts') for p in config.get(field, []) if isinstance(p, dict)}
            context = dict(costSource=[r for r in current.get('costSource', []) if r.get('goodsId') in goods],
                           sourceCatalog=[r for r in current.get('sourceCatalog', []) if r.get('goodsId') in goods],
                           sharedCostScope=current.get('sharedCostScope'), erpSync=current.get('erpSync'))
            prepared_input = [{**r, 'current': by_id[r['id']][1], 'order': by_id[r['id']][0]} for r in rows]
            stored = [self.store.get('configuration', r['id']) for r in rows] if enabled else [None] * len(rows)
            prepared = self.domain('prepareBatchConfigurations', context, prepared_input, stored)
            changes = prepared['rows']
            if not changes:
                receipt = dict(operationId=operation, revision=current['revision'], updatedAt=current.get('updatedAt'),
                               configs=[by_id[r['id']][1] for r in rows], logs=current.get('logs', []), rebased=rebased, unchanged=True)
                with self.store.transaction():
                    self.store.put_batch_receipt(operation, request_hash, receipt)
                return receipt
            materialized = {c['id']: c for c in prepared['configs']}
            next_state = {**current, 'configs': [materialized.get(c['id'], c) for c in current['configs']],
                          'revision': current['revision'] + 1, 'updatedAt': now()}
            message = str(incoming.get('message') or '批量修改配件')[:160]
            operator = (self.cloud.member or {}).get('name') or self.actor(incoming.get('operator'))
            activity = self.domain('batchActivityEntries', changes, dict(operator=operator, message=message), current.get('logs', []))
            next_state['logs'] = activity['logs']
            receipt = dict(operationId=operation, revision=next_state['revision'], updatedAt=next_state['updatedAt'],
                           configs=[materialized[r['id']] for r in rows], activityDelta=activity['events'], rebased=rebased)
            self.flush_history()
            self.history.record(current, self.scope(), '修改前自动备份')
            self.store.edit_many(changes, state=next_state, actor=self.cloud.audit_actor(), prepared=True,
                                 receipt=(operation, request_hash, receipt), replace=not enabled)
            self.state = next_state
            self.record_history(next_state, message)
            # SQLite's workspaceState is authoritative on restart. If a sidecar
            # write fails, the operation can be retried using its saved receipt.
            atomic(self.local / 'state.json', dumps(next_state))
            self.save_affected_products(current, next_state)
            self.profit.publish()
            return receipt

    def sql_product(self, goods_id, cookie):
        with self.lock:
            owner, epoch = self.cloud.owner(cookie), self.cloud.epoch
        credential = self.credentials.read(owner)
        if not credential.get('saved'):
            raise AppError('请先在数据库同步中保存连接设置；当前仅可查看已同步的 ERP 数据')
        config = settings(credential['settings'])
        scope = digest(dict(server=config['server'].lower(), port=config['port'], database=config['database'].lower()))
        with self.lock:
            self.check_sql_scope(scope)
        result = read_product(config, credential['password'], goods_id)
        with self.lock:
            if self.cloud.owner(cookie) != owner or self.cloud.epoch != epoch:
                raise AppError('登录身份已变化，请重新查询')
            self.check_sql_scope(scope)
        return result

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
