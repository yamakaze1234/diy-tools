"""CloudBase transport and background synchronization; no UI-thread network I/O."""
import re
import threading
import time
from urllib.parse import quote
import requests
from common import AppError, uid, now, dumps, atomic, digest

AUTO_SYNC_SECONDS = 2 * 60 * 60


class Cloud:
    def __init__(self, service, transport=None):
        self.s = service
        self.transport = transport
        self.token = self.member = self.cookie = None
        self.expires = 0
        self.epoch = 0
        self.auth_changing = False
        self.auth_lock = threading.Lock()
        self.paused = self.running = False
        self.error = self.last_synced = self.progress = None
        self.csrf = uid()
        self.wake = threading.Event()
        self.manual_requested = False
        self.next_auto_sync = self.s.store.meta('nextAutoSyncAt') or int((time.time() + AUTO_SYNC_SECONDS) * 1000)
        self.s.store.set_meta('nextAutoSyncAt', self.next_auto_sync)
        self.stopping = threading.Event()
        self.idle = threading.Event()
        self.idle.set()
        self.thread = threading.Thread(target=self._loop, name='cloud-sync', daemon=True)
        self.thread.start()

    def enabled(self):
        return bool(self.s.store.meta('enabled'))

    def authenticated(self, cookie):
        return bool(self.token and time.time() < self.expires and self.cookie and f'diy_session={self.cookie}' in [x.strip() for x in (cookie or '').split(';')])

    def require_login(self, cookie):
        if not self.authenticated(cookie):
            raise AppError('请先登录成员账号', 401)

    def owner(self, cookie):
        self.require_login(cookie)
        return dumps([self.member['workspaceId'], self.member['uid']])

    def call(self, action, payload=None, token=None):
        token = token or self.token
        if not token:
            raise AppError('请先登录成员账号', 401)
        request = dict(protocolVersion=2, action=action, requestId=uid(), payload=payload or {})
        if self.transport:
            return self.transport(request, token)
        config = self.s.config
        if not config or not re.fullmatch('[a-z0-9-]+', config.get('envId', '')) or config.get('functionName') != 'workbenchApi':
            raise AppError('云端配置无效')
        url = f"https://{config['envId']}.api.tcloudbasegateway.com/v1/functions/workbenchApi"
        try:
            response = requests.post(url, headers={'Authorization': 'Bearer ' + token}, json={**request, 'accessToken': token}, timeout=(10, 30))
            result = response.json()
        except (requests.RequestException, ValueError):
            raise AppError('云端连接超时或返回无效，请检查网络后重试') from None
        if response.status_code == 401 or result.get('code') == 'UNAUTHENTICATED':
            with self.s.lock:
                if token == self.token:
                    self.token = self.member = None
            raise AppError('登录已过期，请重新登录', 401, 'UNAUTHENTICATED')
        if not response.ok:
            raise AppError(f'云端请求失败（{response.status_code}）')
        return result

    def login(self, data):
        if not isinstance(data.get('accessToken'), str) or not 0 < len(data['accessToken']) <= 16000:
            raise AppError('登录信息无效')
        if not self.auth_lock.acquire(blocking=False):
            raise AppError('正在切换登录状态，请稍后重试')
        try:
            with self.s.lock:
                epoch = self.epoch
                self.auth_changing = True
            verified = self.call('session.get', token=data['accessToken'])
            if not verified.get('ok') or not verified.get('uid') or not verified.get('workspaceId'):
                raise AppError('成员身份校验失败')
            with self.s.lock:
                if epoch != self.epoch:
                    raise AppError('登录已取消，请重新登录')
                if data.get('resumeUid') and data['resumeUid'] != verified['uid']:
                    raise AppError('请用原账号重新登录，以保留当前编辑；进入工作台后可切换账号')
                if self.token and self.member['uid'] != verified['uid']:
                    raise AppError('请先退出当前账号，再切换账号')
                different = self.s.store.meta('uid') != verified['uid']
            if different and not self.idle.wait(90):
                raise AppError('原账号同步尚未结束，请稍后重试')
            with self.s.lock:
                if epoch != self.epoch:
                    raise AppError('登录已取消，请重新登录')
                self.s.store.switch_member(verified['workspaceId'], verified['uid'])
                self.token, self.member, self.error = data['accessToken'], verified, None
                try:
                    retained = float(data.get('retainedUntil', 0)) / 1000
                except (ValueError, TypeError):
                    retained = 0
                self.expires = min(retained, time.time() + 604800) if retained > time.time() else time.time() + 604800
                if not self.enabled() and verified.get('ready') is True and not self.s.store.records() and all(not self.s.state.get(k) for k in ('configs', 'templates', 'sourceCatalog', 'costSource', 'caseGallery')):
                    self.s.store.set_meta('enabled', True)
                self.cookie = self.cookie or uid()
                # Only an empty workstation needs an immediate initial download.
                bootstrap = self.enabled() and not self.s.store.get('workspace_meta', 'root')
                if bootstrap:
                    self.manual_requested = True
                return self.status(), self.cookie
        finally:
            with self.s.lock:
                self.auth_changing = False
            self.auth_lock.release()
            self.wake.set()

    def logout(self, cookie):
        with self.s.lock:
            if self.token:
                self.require_login(cookie)
            self.epoch += 1
            self.auth_changing = True
            self.token = self.member = self.cookie = None
            self.manual_requested = False
        if not self.idle.wait(90):
            raise AppError('正在结束原账号同步，请稍后重试')
        with self.s.lock:
            self.auth_changing = False
            self.error = None
        return dict(signedIn=False)

    def status(self):
        return {**self.s.store.status(), 'enabled': self.enabled(), 'signedIn': bool(self.token and time.time() < self.expires), 'member': self.member, 'paused': self.paused, 'running': self.running, 'lastError': self.error, 'lastSyncedAt': self.last_synced, 'progress': self.progress, 'autoSyncIntervalMs': AUTO_SYNC_SECONDS * 1000, 'nextAutoSyncAt': self.next_auto_sync, 'configured': bool(self.s.config), 'changeHistory': True, 'workspaceRevision': self.s.state.get('revision', 0), 'inventorySources': [dict(id='company-sql', name='公司数据库', configured=True), dict(id='browser-script', name='脚本抓取', configured=True)]}

    def schedule(self, manual=False):
        with self.s.lock:
            if manual and not self.running:
                self.manual_requested = True
        self.wake.set()

    def begin_cycle(self):
        """Called under the service lock; edits never advance the cloud deadline."""
        if self.running or not self.token or time.time() >= self.expires or self.auth_changing or not self.enabled():
            return None
        if not self.manual_requested and (self.paused or time.time() * 1000 < self.next_auto_sync):
            return None
        self.manual_requested = False
        self.next_auto_sync = int((time.time() + AUTO_SYNC_SECONDS) * 1000)
        self.s.store.set_meta('nextAutoSyncAt', self.next_auto_sync)
        self.running = True
        self.idle.clear()
        return self.token, self.epoch

    def _loop(self):
        while not self.stopping.is_set():
            self.wake.wait(min(60, max(1, self.next_auto_sync / 1000 - time.time())))
            self.wake.clear()
            if self.stopping.is_set():
                return
            with self.s.lock:
                cycle = self.begin_cycle()
                if cycle is None:
                    continue
                token, epoch = cycle
            try:
                self.cycle(token, epoch)
            except Exception as error:
                with self.s.lock:
                    self.error = str(error) if isinstance(error, AppError) else '同步处理失败，修改已保存在本机，请重试或查看诊断记录'
            finally:
                with self.s.lock:
                    self.running = False
                    self.idle.set()

    def check_cycle(self, epoch):
        if self.stopping.is_set() or epoch != self.epoch:
            raise AppError('同步已停止，本机修改保留')

    def cycle(self, token, epoch):
        with self.s.lock:
            self.error = None
            before = self.s.store.meta('cursor') or 0
            pending = self.s.store.status()['pending']
            state = self.s.state  # States are replaced, never mutated outside the lock.
            self.progress = dict(phase='upload', cursor=before)
        self.upload_assets(state, token)
        for _ in range(1000):
            with self.s.lock:
                self.check_cycle(epoch)
                batch = self.s.store.next_batch()
            if not batch:
                break
            response = self.call('sync.pushBatch', dict(requests=batch), token)
            if not response.get('ok'):
                raise AppError(response.get('code') or '云端批次结果无效')
            with self.s.lock:
                # Acknowledge confirmed receipts even if logout was requested in flight.
                self.s.store.acknowledge(batch, response.get('results'))
        with self.s.lock:
            if self.s.store.status()['uncertain']:
                raise AppError('提交结果待确认')
        head = None
        for _ in range(5000):
            with self.s.lock:
                self.check_cycle(epoch)
                payload = dict(cursor=self.s.store.meta('cursor') or 0, limit=100)
            if head is not None:
                payload['headSeq'] = head
            page = self.call('sync.pull', payload, token)
            if not page.get('ok'):
                raise AppError(page.get('code') or '拉取失败')
            head = page['headSeq'] if head is None else head
            if page['headSeq'] != head:
                raise AppError('同步快照在分页期间变化')
            with self.s.lock:
                self.s.store.apply_page(page)
                self.progress = dict(phase='download', cursor=page['nextCursor'], total=head)
            if not page.get('hasMore'):
                with self.s.lock:
                    if pending or before != self.s.store.meta('cursor') or not self.s.store.db.execute("SELECT 1 FROM meta WHERE key='workspaceState'").fetchone():
                        self.materialize()
                    self.error, self.last_synced = None, now()
                return
        raise AppError('本轮同步达到上限，下轮继续')

    def materialize(self):
        if not self.s.store.get('workspace_meta', 'root'):
            return
        current = self.s.state
        next_state = self.s.domain('applyWorkspace', current, self.s.store.records())
        events = self.s.domain('recentActivity', self.s.store.meta('activity') or [])
        next_state['logs'] = self.s.domain('recentActivity', [r for r in events if r.get('operator') != (self.member or {}).get('memberId')] + current.get('logs', []))
        if self.s.domain('projectWorkspace', current) == self.s.domain('projectWorkspace', next_state) and current.get('logs') == next_state['logs']:
            return
        next_state.update(revision=current['revision'] + 1, updatedAt=now())
        self.s.store.set_meta('workspaceState', next_state)
        self.s.save(next_state, '接收云端更新')

    def persist(self, before, next_state, expected=None):
        if not self.enabled():
            return next_state
        if not self.s.store.get('workspace_meta', 'root'):
            raise AppError('首次云端数据仍在下载，请稍后编辑')
        changes = self.s.domain('changesBetween', before if expected is None else expected, next_state)
        merged = []

        def materialize():
            value = self.s.domain('applyWorkspace', next_state, self.s.store.records())
            merged.append(value)
            return value
        self.s.store.edit_many(changes, materialize, actor=self.audit_actor())
        return merged[0]

    def audit_actor(self):
        member = self.member or {}
        return {k: member.get(k) for k in ('uid', 'memberId', 'name')}

    def inspect_changes(self, action, data, cookie):
        """Read cloud evidence without acknowledging or advancing the local cursor."""
        with self.s.lock:
            self.require_login(cookie)
            if not self.enabled():
                raise AppError('请先启用同步')
            token, epoch, member = self.token, self.epoch, dict(self.member)
            local = {(r['type'], r['id']): r for r in self.s.store.records()}
            cursor = self.s.store.meta('cursor') or 0
            revision = self.s.state.get('revision', 0)
        bootstrap = self.call('sync.bootstrap', token=token)
        head = bootstrap.get('headSeq')
        if not bootstrap.get('ok') or type(head) is not int or head < cursor:
            raise AppError('云端版本信息无效，请重试')
        if action == 'commits':
            before = data.get('before', head + 1)
            if type(before) is not int or not 1 <= before <= head + 1:
                raise AppError('提交页码无效')
            end = before - 1
            start = max(0, end - 50)
        else:
            start, end = cursor, head
        changes, position = [], start
        while position < end:
            with self.s.lock:
                self.check_cycle(epoch)
                self.require_login(cookie)
            page = self.call('sync.pull', dict(cursor=position, headSeq=end, limit=100), token)
            if not page.get('ok') or page.get('headSeq') != end or not isinstance(page.get('changes'), list) or not page['changes']:
                raise AppError('云端记录分页无效，请重试')
            for change in page['changes']:
                if change.get('seq') != position + 1 or change['seq'] > end:
                    raise AppError('云端记录序号不连续，请重试')
                position = change['seq']
                changes.append(change)
            if page.get('nextCursor') != position:
                raise AppError('云端记录游标无效，请重试')
        with self.s.lock:
            self.check_cycle(epoch)
            self.require_login(cookie)
            if action == 'compare' and (revision != self.s.state.get('revision', 0) or cursor != (self.s.store.meta('cursor') or 0)):
                raise AppError('查看期间本机版本已变化，请重新比较')
        from store import clean, keep
        if action == 'commits':
            records = [dict(id=c.get('mutationId'), seq=c['seq'], type=c['type'], entityId=c['id'], version=c['version'],
                            at=c.get('updatedAt'), actorId=c.get('updatedBy'),
                            actorName=member.get('name') if c.get('updatedBy') == member.get('memberId') else None,
                            data=clean(c['data'])) for c in reversed(changes) if keep(c['type'])]
            return dict(records=records, nextBefore=start + 1 if start else None, headSeq=end)
        remote = {(c['type'], c['id']): c for c in changes if keep(c['type'])}
        keys = set(remote) | {k for k, r in local.items() if r['draft'] != r['base']}
        records = []
        for kind, key in sorted(keys):
            row = local.get((kind, key)) or dict(base=None, draft=None, version=0)
            latest = remote.get((kind, key))
            cloud = clean(latest['data']) if latest else row['base']
            if row['draft'] == cloud:
                continue
            merged = self.s.domain('mergeRecord', row['base'], row['draft'], cloud)
            records.append(dict(type=kind, id=key, base=row['base'], local=row['draft'], cloud=cloud,
                                baseVersion=row['version'], cloudVersion=latest['version'] if latest else row['version'],
                                fields=merged['fields'], localChanged=row['draft'] != row['base'], cloudChanged=cloud != row['base']))
        return dict(records=records, headSeq=head, cursor=cursor)

    def enable(self, data, cookie):
        latest = self.call('session.get')
        with self.s.lock:
            self.require_login(cookie)
            if self.enabled():
                raise AppError('此目录已经启用同步')
            if not latest.get('ok') or latest.get('uid') != self.member['uid'] or latest.get('workspaceId') != self.member['workspaceId']:
                raise AppError('成员身份校验失败')
            summary = self.s.domain('migrationSummary', self.s.state)
            mode = data.get('mode')
            if mode == 'publish' and (latest.get('ready') or summary['hash'] != data.get('previewHash') or summary['issues']):
                raise AppError('预览已变化、存在待处理项，或云端已有数据，请重新预览/选择接收')
            if mode not in ('publish', 'join') or (mode == 'join' and not latest.get('ready')):
                raise AppError('请选择有效的发布或接收方式')
            atomic(self.s.local / 'backups' / ('before-sync-' + uid() + '.json'), dumps(self.s.state))
            if mode == 'publish':
                self.s.store.edit_many(summary['records'] + [dict(type='workspace_meta', id='root', data=dict(format=2, createdAt=now(), counts=summary['counts']))], self.s.state, actor=self.audit_actor())
            self.s.store.set_meta('enabled', True)
            self.schedule(manual=True)
            return self.status()

    def asset_endpoint(self, name):
        with self.s.lock:
            workspace = self.s.store.meta('workspaceId')
        if not workspace:
            raise AppError('请先登录同步')
        return f"https://{self.s.config['envId']}.api.tcloudbasegateway.com/v1/storages/object/workbench-assets/{quote(workspace, safe='')}/{name}"

    @staticmethod
    def asset_name(url):
        match = re.fullmatch(r'/uploads/([a-f0-9]{64}\.(?:png|jpg))', url)
        if not match:
            raise AppError('素材路径无效')
        return match[1]

    def download_asset(self, url, token=None):
        name = self.asset_name(url)
        file = self.s.local / 'assets' / name
        if file.exists():
            data = file.read_bytes()
        else:
            try:
                response = requests.get(self.asset_endpoint(name), headers={'Authorization': 'Bearer ' + (token or self.token or '')}, timeout=(10, 30))
                if not response.ok:
                    raise AppError(f'原始图片下载失败（{response.status_code}）')
                data = response.content
            except requests.RequestException:
                raise AppError('原始图片下载超时，请重试') from None
            if len(data) > 24 * 1024 * 1024 or digest(data) != name.split('.')[0]:
                raise AppError('原始图片校验失败')
            atomic(file, data)
        if digest(data) != name.split('.')[0]:
            raise AppError('原始图片校验失败')
        return data

    def upload_assets(self, state, token):
        urls = set()

        def walk(value):
            if isinstance(value, str) and value.startswith('/uploads/'):
                urls.add(value)
            elif isinstance(value, (dict, list)):
                for child in value.values() if isinstance(value, dict) else value:
                    walk(child)
        walk({k: state.get(k) for k in ('configs', 'templates', 'caseGallery')})
        with self.s.lock:
            done = set(self.s.store.meta('uploadedAssets') or [])
        for url in urls:
            if self.stopping.is_set() or token != self.token:
                raise AppError('同步已停止，本机修改保留')
            name = self.asset_name(url)
            if name in done:
                continue
            data = self.download_asset(url, token)
            endpoint = self.asset_endpoint(name)
            headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'image/png' if name.endswith('.png') else 'image/jpeg', 'x-upsert': 'false'}
            try:
                response = requests.post(endpoint, headers=headers, data=data, timeout=(10, 60))
                if not response.ok:
                    if response.status_code not in (400, 409):
                        raise AppError(f'原始图片上传失败（{response.status_code}）')
                    check = requests.get(endpoint, headers={'Authorization': 'Bearer ' + token}, timeout=(10, 30))
                    if not check.ok or digest(check.content) != name.split('.')[0]:
                        raise AppError('原图上传未确认，请重试')
            except requests.RequestException:
                raise AppError('原图上传未确认，稍后将校验并继续') from None
            done.add(name)
            with self.s.lock:
                self.s.store.set_meta('uploadedAssets', sorted(done))

    def close(self):
        self.stopping.set()
        self.wake.set()
        self.thread.join()
