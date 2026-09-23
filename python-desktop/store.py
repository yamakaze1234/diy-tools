"""SQLite outbox, three-way merge and version history, compatible with 0.2.21."""
import json
import sqlite3
import zlib
from pathlib import Path
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from common import dumps, digest, now, uid, AppError

LOCAL_FIELDS = set('erp stockAvailable stockUpdatedAt stockSource erpUpdatedAt erpImportedAt erpMissing erpUnknown erpName localInventoryOnly'.split())


def clean(value):
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if k not in LOCAL_FIELDS}
    return value


def keep(kind):
    return kind not in ('erp_chunk', 'erp_snapshot')


class Store:
    def __init__(self, path, domain):
        self.domain = domain
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records(type TEXT NOT NULL,id TEXT NOT NULL,base TEXT,version INTEGER NOT NULL DEFAULT 0,draft TEXT,conflict TEXT,PRIMARY KEY(type,id));
        CREATE TABLE IF NOT EXISTS outbox(mutation_id TEXT PRIMARY KEY,type TEXT NOT NULL,id TEXT NOT NULL,request TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,UNIQUE(type,id));
        CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,sha256 TEXT NOT NULL,content TEXT NOT NULL);''')
        self.db.execute('''CREATE TABLE IF NOT EXISTS local_changes(
            seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
            workspace TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
            changes TEXT NOT NULL)''')
        self.cache = None
        if not self.meta('deviceId'):
            self.set_meta('deviceId', uid())
        self.migrate_erp()

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            self.cache = None
            raise

    def meta(self, key):
        row = self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set_meta(self, key, value):
        self.db.execute('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, dumps(value)))

    @staticmethod
    def decode(row):
        if row is None:
            return None
        value = dict(row)
        for key in ('base', 'draft', 'conflict'):
            value[key] = json.loads(value[key]) if value[key] else None
        return value

    def get(self, kind, key):
        return self.decode(self.db.execute('SELECT * FROM records WHERE type=? AND id=?', (kind, key)).fetchone())

    def records(self):
        return [self.decode(row) for row in self.db.execute('SELECT * FROM records ORDER BY type,id')]

    def materialized_records(self):
        """Only current drafts are needed to rebuild the editing state."""
        return [dict(type=row['type'], id=row['id'], draft=json.loads(row['draft']) if row['draft'] else None)
                for row in self.db.execute('SELECT type,id,draft FROM records ORDER BY type,id')]

    def switch_member(self, workspace, member):
        if not workspace or not member:
            raise AppError('成员身份不完整')
        with self.transaction():
            if self.meta('workspaceId') and self.meta('workspaceId') != workspace:
                raise AppError('此账号不属于当前工作区，请使用当前工作区的成员账号')
            if self.meta('uid') and self.meta('uid') != member:
                status = self.status()
                if any(status[k] for k in ('pending', 'uncertain', 'conflicts')):
                    raise AppError('原账号还有未同步修改或冲突，请先用原账号登录并完成同步，再切换账号')
                self.backup()
            self.set_meta('workspaceId', workspace)
            self.set_meta('uid', member)

    def log_local(self, changes, actor):
        changes = [clean(c) for c in changes if c.get('before') != c.get('after')]
        if changes:
            self.db.execute('INSERT INTO local_changes(id,workspace,at,actor,changes) VALUES(?,?,?,?,?)',
                            (uid(), self.meta('workspaceId') or 'local', now(), dumps(actor), dumps(changes)))

    def local_history(self, before=None):
        if before is not None and (type(before) is not int or before < 1):
            raise AppError('记录页码无效')
        rows = self.db.execute('SELECT * FROM local_changes WHERE workspace=? AND seq<? ORDER BY seq DESC LIMIT 51',
                               (self.meta('workspaceId') or 'local', before or 9223372036854775807)).fetchall()
        records = [{**dict(r), 'actor': json.loads(r['actor']), 'changes': json.loads(r['changes'])} for r in rows[:50]]
        return dict(records=records, nextBefore=records[-1]['seq'] if len(rows) > 50 else None)

    def edit_many(self, changes, state=None, actor=None):
        with self.transaction():
            audit = []
            for change in changes:
                kind, key, data = change['type'], change['id'], change['data']
                row = self.get(kind, key)
                if 'expectedDraft' in change and row:
                    merged = self.domain('mergeRecord', change['expectedDraft'], data, row['draft'])
                    if merged['fields']:
                        raise AppError('编辑期间同一字段已变化：' + '、'.join(merged['fields']), 409)
                    data = merged['value']
                self.domain('validateWorkspaceRecord', kind, key, data)
                audit.append(dict(type=kind, id=key, before=row['draft'] if row else change.get('expectedDraft'), after=data))
                self.db.execute('INSERT INTO records(type,id,base,version,draft) VALUES(?,?,?,0,?) ON CONFLICT(type,id) DO UPDATE SET draft=excluded.draft', (kind, key, 'null', dumps(data)))
            if state is not None:
                self.set_meta('workspaceState', state() if callable(state) else state)
            if actor is not None:
                self.log_local(audit, actor)

    def next_batch(self):
        with self.transaction():
            batch = [json.loads(r[0]) for r in self.db.execute('SELECT request FROM outbox ORDER BY rowid LIMIT 50')]
            if batch:
                return batch
            size = 0
            for raw in self.db.execute("SELECT * FROM records WHERE conflict IS NULL AND draft<>base ORDER BY CASE type WHEN 'workspace_meta' THEN 2 ELSE 0 END,type,id").fetchall():
                row = self.decode(raw)
                if row['base'] == row['draft']:
                    continue
                if row['type'] == 'workspace_meta' and self.db.execute('SELECT 1 FROM records WHERE conflict IS NOT NULL LIMIT 1').fetchone():
                    continue
                request = dict(protocolVersion=2, action='sync.push', requestId=uid(), payload=dict(mutationId=uid(), deviceId=self.meta('deviceId'), entityType=row['type'], entityId=row['id'], baseVersion=row['version'], after=row['draft']))
                body = dumps(request)
                length = len(body.encode('utf-8'))
                if batch and (len(batch) >= 50 or size + length > 210000):
                    break
                self.db.execute('INSERT INTO outbox(mutation_id,type,id,request) VALUES(?,?,?,?)', (request['payload']['mutationId'], row['type'], row['id'], body))
                batch.append(request)
                size += length
            return batch

    def acknowledge(self, requests, results):
        if not isinstance(results, list) or len(requests) != len(results):
            raise AppError('云端批次结果无效')
        with self.transaction():
            for request, result in zip(requests, results):
                result = clean(result)
                p = request['payload']
                kind, key = p['entityType'], p['entityId']
                row = self.get(kind, key)
                if not row or not self.db.execute('SELECT 1 FROM outbox WHERE mutation_id=?', (p['mutationId'],)).fetchone():
                    raise AppError('提交回执不属于本地队列')
                if result.get('code') == 'CONFLICT':
                    remote = result.get('remote')
                    merged = self.domain('mergeRecord', row['base'], row['draft'], remote['data']) if remote else None
                    if merged and not merged['fields']:
                        self.db.execute('UPDATE records SET base=?,draft=?,version=?,conflict=NULL WHERE type=? AND id=?', (dumps(remote['data']), dumps(merged['value']), remote['version'], kind, key))
                    else:
                        self.db.execute('UPDATE records SET conflict=? WHERE type=? AND id=?', (dumps(result), kind, key))
                elif result.get('ok') and result.get('record'):
                    remote = result['record']
                    self.domain('validateWorkspaceRecord', kind, key, remote['data'])
                    merged = self.domain('mergeRecord', p['after'], row['draft'], remote['data'])
                    conflict = dict(code='CONFLICT', fields=merged['fields'], base=p['after'], remote=remote, local=row['draft']) if merged['fields'] else None
                    self.db.execute('UPDATE records SET base=?,version=?,draft=?,conflict=? WHERE type=? AND id=?', (dumps(remote['data']), remote['version'], dumps(merged['value']), dumps(conflict) if conflict else None, kind, key))
                else:
                    raise AppError(result.get('message') or result.get('code') or '云端返回格式无效')
                self.db.execute('DELETE FROM outbox WHERE mutation_id=?', (p['mutationId'],))

    def apply_page(self, page):
        with self.transaction():
            cursor = self.meta('cursor') or 0
            if not page.get('ok') or not isinstance(page.get('changes'), list) or type(page.get('headSeq')) is not int or type(page.get('nextCursor')) is not int or page['headSeq'] < cursor:
                raise AppError('同步分页格式无效')
            activity = []
            for change in page['changes']:
                if change['seq'] != cursor + 1 or change['seq'] > page['headSeq']:
                    raise AppError('同步序号不连续，已保留游标')
                cursor = change['seq']
                kind, key = change['type'], change['id']
                if not keep(kind):
                    continue
                change = {**change, 'data': clean(change['data'])}
                self.domain('validateWorkspaceRecord', kind, key, change['data'])
                row = self.get(kind, key)
                options = dict(at=change.get('updatedAt', now()), operator=change.get('updatedBy') or '未知云端成员', origin='cloud', eventId='cloud:' + str(cursor))
                entry = self.domain('activityEntry', kind, key, row['base'] if row else None, change['data'], options)
                if entry:
                    activity.append(entry)
                if self.db.execute('SELECT 1 FROM outbox WHERE type=? AND id=?', (kind, key)).fetchone():
                    raise AppError('先核实未确认提交，再拉取该记录')
                if not row or change['version'] > row['version']:
                    merged = self.domain('mergeRecord', row['base'], row['draft'], change['data']) if row else dict(value=change['data'], fields=[])
                    conflict = row['conflict'] if row else None
                    if not conflict and merged['fields']:
                        conflict = dict(code='CONFLICT', fields=merged['fields'], base=row['base'], local=row['draft'], remote=change)
                    self.db.execute('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET base=excluded.base,version=excluded.version,draft=excluded.draft,conflict=excluded.conflict', (kind, key, dumps(change['data']), change['version'], dumps(merged['value']), dumps(conflict) if conflict else None))
            if page['nextCursor'] != cursor or (page.get('hasMore') and not page['changes']):
                raise AppError('游标与分页结果不一致')
            if activity:
                self.set_meta('activity', self.domain('recentActivity', activity + (self.meta('activity') or [])))
            self.set_meta('cursor', cursor)

    def resolve(self, kind, key, choice, actor=None):
        with self.transaction():
            row = self.get(kind, key)
            if not row or not row['conflict'] or not row['conflict'].get('remote'):
                raise AppError('冲突已变化，请刷新')
            remote = row['conflict']['remote']
            data = remote['data'] if choice == 'remote' else row['draft'] if choice == 'local' else choice
            self.domain('validateWorkspaceRecord', kind, key, data)
            self.db.execute('UPDATE records SET base=?,version=?,draft=?,conflict=NULL WHERE type=? AND id=?', (dumps(remote['data']), remote['version'], dumps(data), kind, key))
            if actor is not None:
                self.log_local([dict(type=kind, id=key, before=row['draft'], after=data)], actor)

    def status(self):
        serial = (self.db.total_changes, self.db.execute('PRAGMA data_version').fetchone()[0])
        if self.cache and self.cache[0] == serial:
            return dict(self.cache[1])
        records = self.records()
        value = dict(workspaceId=self.meta('workspaceId'), uid=self.meta('uid'), deviceId=self.meta('deviceId'), cursor=self.meta('cursor') or 0, pending=sum(r['base'] != r['draft'] for r in records), uncertain=self.db.execute('SELECT count(*) FROM outbox').fetchone()[0], conflicts=sum(bool(r['conflict']) for r in records))
        self.cache = serial, value
        return dict(value)

    def backup(self):
        content = dumps(dict(format=1, protocolVersion=2, enabled=bool(self.meta('enabled')), workspaceState=self.meta('workspaceState'), workspaceId=self.meta('workspaceId'), uid=self.meta('uid'), cursor=self.meta('cursor') or 0, records=self.records(), outbox=[dict(r) for r in self.db.execute('SELECT * FROM outbox')]))
        result = dict(id=uid(), createdAt=now(), sha256=digest(content), content=content)
        self.db.execute('INSERT INTO backups VALUES(?,?,?,?)', tuple(result.values()))
        return result

    def migrate_erp(self):
        if self.meta('localErpPolicy') == 1:
            return
        with self.transaction():
            if self.records():
                self.backup()
            for row in self.records():
                kind, key = row['type'], row['id']
                if not keep(kind):
                    self.db.execute('DELETE FROM outbox WHERE type=? AND id=?', (kind, key))
                    self.db.execute('DELETE FROM records WHERE type=? AND id=?', (kind, key))
                    continue
                base, draft, conflict, version = clean(row['base']), clean(row['draft']), clean(row['conflict']), row['version']
                if conflict and conflict.get('remote'):
                    merged = self.domain('mergeRecord', base, draft, conflict['remote']['data'])
                    if not merged['fields']:
                        base, draft, version, conflict = conflict['remote']['data'], merged['value'], conflict['remote']['version'], None
                    else:
                        conflict['fields'] = merged['fields']
                self.db.execute('UPDATE records SET base=?,draft=?,version=?,conflict=? WHERE type=? AND id=?', (dumps(base), dumps(draft), version, dumps(conflict) if conflict else None, kind, key))
            for row in self.db.execute('SELECT * FROM outbox').fetchall():
                after = json.loads(row['request'])['payload']['after']
                if after != clean(after):
                    self.db.execute('DELETE FROM outbox WHERE mutation_id=?', (row['mutation_id'],))
            self.set_meta('localErpPolicy', 1)

    def close(self):
        self.db.close()


class History:
    LIMIT = 5 * 1024 ** 3
    TRIGGER = 4608 * 1024 ** 2

    def __init__(self, path, domain):
        self.path = Path(path)
        self.domain = domain
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('CREATE TABLE IF NOT EXISTS history_maintenance(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,scope TEXT NOT NULL,at TEXT NOT NULL,revision INTEGER NOT NULL,reason TEXT NOT NULL,hash TEXT NOT NULL,content TEXT NOT NULL);')
        columns = {r['name'] for r in self.db.execute('PRAGMA table_info(versions)')}
        for name, definition in (('encoding', "TEXT NOT NULL DEFAULT 'json'"), ('name', 'TEXT'), ('pinned', 'INTEGER NOT NULL DEFAULT 0')):
            if name not in columns:
                self.db.execute(f'ALTER TABLE versions ADD COLUMN {name} {definition}')

    def bytes_used(self):
        return sum(p.stat().st_size for p in (self.path, self.path.with_name(self.path.name + '-wal')) if p.exists())

    def stats(self, scope=None):
        clause, args = ('WHERE scope=?', (scope,)) if scope is not None else ('', ())
        rows = self.db.execute(f'SELECT count(*) n,coalesce(sum(pinned),0) named FROM versions {clause}', args).fetchone()
        last = self.db.execute("SELECT value FROM history_maintenance WHERE key='last_cleanup'").fetchone()
        return dict(bytes=self.bytes_used(), limit=self.LIMIT, count=rows['n'], named=rows['named'], lastCleanup=last[0] if last else None)

    def _protected(self):
        return 'pinned=1 OR rowid IN (SELECT max(rowid) FROM versions GROUP BY scope)'

    def _delete(self, where, args=()):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            count = self.db.execute(f'DELETE FROM versions WHERE {where} AND NOT ({self._protected()})', args).rowcount
            self.db.execute('COMMIT')
            return count
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def reclaim(self):
        # VACUUM cannot run inside a transaction. The live database remains valid
        # when SQLite cannot reserve the extra temporary disk space.
        self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.db.execute('VACUUM')
        return self.bytes_used()

    def cleanup(self, mode='all', scope=None, preview=False, expected=None):
        if mode not in ('all', '7d', '30d'):
            raise AppError('清理范围无效')
        cutoff = {'7d': 7, '30d': 30}.get(mode)
        where = 'pinned=0'
        args = []
        if scope is not None:
            where += ' AND scope=?'; args.append(scope)
        if cutoff:
            where += ' AND julianday(at)<julianday(?)'
            args.append((datetime.now(timezone.utc) - timedelta(days=cutoff)).isoformat())
        candidates = [row[0] for row in self.db.execute(f'SELECT id FROM versions WHERE {where} AND NOT ({self._protected()}) ORDER BY rowid', args)]
        count = len(candidates)
        signature = digest(candidates)
        if preview:
            return dict(count=count, bytes=self.bytes_used(), signature=signature)
        if expected is not None and signature != expected:
            raise AppError('历史记录已变化，请重新预览清理范围', 409)
        before = self.bytes_used()
        removed = self._delete(where, args)
        after = self.reclaim() if removed else before
        return dict(removed=removed, before=before, after=after)

    def _capacity(self, incoming):
        if self.bytes_used() + incoming < self.TRIGGER:
            return
        page_size = self.db.execute('PRAGMA page_size').fetchone()[0]
        free_bytes = lambda: self.db.execute('PRAGMA freelist_count').fetchone()[0] * page_size
        while self.bytes_used() - free_bytes() + incoming >= self.TRIGGER:
            candidate = self.db.execute(f'SELECT rowid FROM versions WHERE NOT ({self._protected()}) ORDER BY rowid LIMIT 1').fetchone()
            if not candidate:
                raise AppError('历史空间已满，请在历史数据管理中清理命名版本')
            self._delete('rowid=?', (candidate[0],))
        if self.bytes_used() + incoming >= self.TRIGGER:
            self.reclaim()
        if self.bytes_used() + incoming >= self.LIMIT:
            raise AppError('历史空间已满，请清理旧版本')

    def record(self, state, scope, reason):
        content = dumps(state)
        hashed = digest(content)
        last = self.db.execute('SELECT hash FROM versions WHERE scope=? ORDER BY rowid DESC LIMIT 1', (scope,)).fetchone()
        if last and last[0] == hashed:
            return None
        packed = zlib.compress(content.encode('utf-8'), 6)
        self._capacity(len(packed) + 4096)
        self.db.execute('BEGIN IMMEDIATE')
        try:
            key = uid()
            self.db.execute('INSERT INTO versions(id,scope,at,revision,reason,hash,content,encoding) VALUES(?,?,?,?,?,?,?,?)', (key, scope, now(), state.get('revision', 0), reason, hashed, packed, 'zlib'))
            self.db.execute('COMMIT')
            return key
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def prune(self, at=None):
        current = at or datetime.now(timezone.utc)
        policy = self.db.execute("SELECT value FROM history_maintenance WHERE key='weekly_policy_started'").fetchone()
        if not policy:
            self.db.execute("INSERT OR REPLACE INTO history_maintenance VALUES('weekly_policy_started',?)", (current.isoformat(),))
            self.db.execute("INSERT OR REPLACE INTO history_maintenance VALUES('last_cleanup',?)", (current.isoformat(),))
            return 0
        last = self.db.execute("SELECT value FROM history_maintenance WHERE key='last_cleanup'").fetchone()
        if last and current - datetime.fromisoformat(last[0]) < timedelta(days=7):
            return 0
        self.db.execute('BEGIN IMMEDIATE')
        try:
            removed = self.db.execute(f'DELETE FROM versions WHERE NOT ({self._protected()})').rowcount
            self.db.execute("INSERT OR REPLACE INTO history_maintenance VALUES('last_cleanup',?)", (current.isoformat(),))
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise
        if removed:
            self.reclaim()
        return removed

    def list(self, scope):
        return [dict(r) for r in self.db.execute('SELECT id,at,revision,reason,name,pinned FROM versions WHERE scope=? ORDER BY rowid DESC LIMIT 100', (scope,))]

    def name_version(self, state, scope, name):
        name = str(name or '').strip()
        if not name or len(name) > 80:
            raise AppError('版本名称须为 1 至 80 个字符')
        key = self.record(state, scope, '手动命名版本')
        if not key:
            key = self.db.execute('SELECT id FROM versions WHERE scope=? ORDER BY rowid DESC LIMIT 1', (scope,)).fetchone()[0]
        self.db.execute('UPDATE versions SET name=?,pinned=1 WHERE id=? AND scope=?', (name, key, scope))
        return key

    def delete_named(self, key, scope):
        row = self.db.execute('SELECT pinned FROM versions WHERE id=? AND scope=?', (key, scope)).fetchone()
        if not row or not row[0]:
            raise AppError('命名版本不存在')
        latest = self.db.execute('SELECT id FROM versions WHERE scope=? ORDER BY rowid DESC LIMIT 1', (scope,)).fetchone()
        if latest and latest[0] == key:
            self.db.execute('UPDATE versions SET pinned=0,name=NULL WHERE id=?', (key,))
        else:
            self.db.execute('DELETE FROM versions WHERE id=? AND scope=?', (key, scope))
            self.reclaim()

    def _content(self, row):
        try:
            content = zlib.decompress(row['content']).decode('utf-8') if row['encoding'] == 'zlib' else row['content']
            if digest(content) != row['hash']:
                raise ValueError('hash mismatch')
            return content
        except (ValueError, zlib.error, UnicodeError) as error:
            raise AppError('历史版本不存在或校验失败') from error

    def get(self, key, scope):
        row = self.db.execute('SELECT * FROM versions WHERE id=? AND scope=?', (key, scope)).fetchone()
        if not row:
            raise AppError('历史版本不存在或校验失败')
        content = self._content(row)
        return {**dict(row), 'content': None, 'state': json.loads(content)}

    def preview(self, key, scope, current, target=None):
        row = self.get(key, scope)
        if (row['state'].get('erpSync') or {}).get('scope', 'unbound') != (current.get('erpSync') or {}).get('scope', 'unbound'):
            raise AppError('该版本属于不同库存来源，不能整库还原')
        changes = self.domain('changesBetween', current, target if target is not None else row['state'])
        counts = {}
        for change in changes:
            counts[change['type']] = counts.get(change['type'], 0) + 1
        return dict(id=key, at=row['at'], revision=row['revision'], hash=row['hash'], baseRevision=current['revision'], counts=counts, changes=[dict(type=c['type'], id=c['id'], name=c['data'].get('name') or c['id'], before=c.get('expectedDraft'), after=c['data']) for c in changes])

    def close(self):
        self.db.close()
