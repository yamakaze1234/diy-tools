import unittest
import tempfile
from pathlib import Path
from datetime import datetime, timedelta, timezone
from store import History
from compact_history import convert
from common import dumps, digest
import sqlite3

class RetentionTests(unittest.TestCase):
    def test_three_days_expires_named_latest_and_all_scopes(self):
        with tempfile.TemporaryDirectory() as directory:
            history = History(Path(directory) / 'versions.sqlite', None)
            try:
                current = datetime.now(timezone.utc)
                for scope in ('a', 'b'):
                    history.record({'revision': 0}, scope, 'old')
                named = history.name_version({'revision': 1}, 'a', 'named')
                history.db.execute('UPDATE versions SET at=?', ((current-timedelta(days=3)).isoformat(),))
                recent = history.record({'revision': 2}, 'b', 'recent')
                # record() already prunes expired snapshots before deduplication.
                self.assertEqual(history.db.execute('SELECT count(*) FROM versions').fetchone()[0], 1)
                self.assertIsNotNone(recent)
                self.assertEqual(history.prune(current+timedelta(days=2)), 0)
                self.assertEqual(history.prune(current+timedelta(days=4)), 1)
                self.assertEqual(history.db.execute('SELECT count(*) FROM versions').fetchone()[0], 0)
            finally:
                history.close()

    def test_boundary_retains_newer_than_72_hours(self):
        with tempfile.TemporaryDirectory() as directory:
            history = History(Path(directory) / 'versions.sqlite', None)
            try:
                key = history.record({'revision': 0}, 'a', 'test')
                at = datetime.now(timezone.utc)
                history.db.execute('UPDATE versions SET at=?', ((at-timedelta(days=3)+timedelta(seconds=1)).isoformat(),))
                self.assertEqual(history.prune(at), 0)
                self.assertEqual(history.prune(at+timedelta(seconds=1)), 1)
            finally:
                history.close()

    def test_compressed_snapshots_and_manual_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            history=History(Path(directory)/'versions.sqlite',None)
            try:
                state={'revision':0,'text':'配置' * 10000}
                first=history.record(state,'a','起点')
                history.record({**state,'revision':1},'a','编辑')
                self.assertEqual(history.get(first,'a')['state'],state)
                row=history.db.execute('SELECT encoding,length(content) FROM versions WHERE id=?',(first,)).fetchone()
                self.assertEqual(row['encoding'],'zlib')
                self.assertLess(row[1],1000)
                self.assertEqual(history.cleanup('all',preview=True)['count'],1)
                result=history.cleanup('all')
                self.assertEqual(result['removed'],1)
                self.assertEqual(history.db.execute('SELECT count(*) FROM versions').fetchone()[0],1)
            finally:
                history.close()

    def test_offline_conversion_keeps_legacy_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'versions.sqlite'
            db=sqlite3.connect(path)
            db.executescript('CREATE TABLE versions(id TEXT PRIMARY KEY,scope TEXT,at TEXT,revision INTEGER,reason TEXT,hash TEXT,content TEXT);CREATE TABLE history_maintenance(key TEXT PRIMARY KEY,value TEXT NOT NULL);')
            content=dumps({'revision':7,'text':'历史' * 1000})
            db.execute('INSERT INTO versions VALUES(?,?,?,?,?,?,?)',('old','a','2026-01-01T00:00:00Z',7,'旧版',digest(content),content))
            db.commit();db.close()
            result=convert(path)
            self.assertEqual(result['records'],1)
            self.assertTrue(Path(result['backup']).exists())
            history=History(path,None)
            try:
                self.assertEqual(history._content(history.db.execute('SELECT * FROM versions WHERE id=?', ('old',)).fetchone()),content)
                self.assertEqual(history.prune(),1)
                self.assertLess(result['afterBytes'],result['beforeBytes']+4096)
            finally:
                history.close()
