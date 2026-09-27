import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from backup_retention import prune_backups


class BackupRetentionTests(unittest.TestCase):
    def test_database_backups_expire_without_touching_live_records(self):
        with tempfile.TemporaryDirectory() as directory:
            db = sqlite3.connect(':memory:', isolation_level=None)
            self.addCleanup(db.close)
            db.executescript('CREATE TABLE backups(created_at TEXT); CREATE TABLE records(id TEXT); INSERT INTO records VALUES ("live");')
            at = datetime.now(timezone.utc)
            db.executemany('INSERT INTO backups VALUES (?)', [((at-timedelta(days=3)).isoformat(),), ((at-timedelta(days=3)+timedelta(seconds=1)).isoformat(),)])
            self.assertEqual(prune_backups(directory, SimpleNamespace(db=db), at), 1)
            self.assertEqual(db.execute('SELECT count(*) FROM backups').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT id FROM records').fetchone()[0], 'live')

    def test_only_managed_backup_files_are_recycled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup = root / 'backups' / 'before-python-test'
            backup.mkdir(parents=True)
            (backup / 'state.json').write_text('{}')
            (root / 'recovery').mkdir()
            draft = root / 'recovery' / 'draft-test.json'
            draft.write_text('{}')
            for name in ('state.json', 'workspace.sqlite', 'versions.sqlite', 'user-export.json'):
                (root / name).write_text('live')
            db = sqlite3.connect(':memory:')
            self.addCleanup(db.close)
            db.execute('CREATE TABLE backups(created_at TEXT)')
            recycled = []
            self.assertEqual(prune_backups(root, SimpleNamespace(db=db), recycler=recycled.append), 0)
            self.assertEqual(prune_backups(root, SimpleNamespace(db=db), datetime.now(timezone.utc)+timedelta(days=4), recycled.append), 2)
            self.assertEqual(set(recycled), {backup, draft})

    def test_recycle_failure_preserves_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'backups').mkdir()
            backup = root / 'backups' / 'test.json'
            backup.write_text('{}')
            db = sqlite3.connect(':memory:')
            self.addCleanup(db.close)
            db.execute('CREATE TABLE backups(created_at TEXT)')
            def fail(path):
                raise RuntimeError('recycle failed')
            with self.assertRaises(RuntimeError):
                prune_backups(root, SimpleNamespace(db=db), datetime.now(timezone.utc)+timedelta(days=4), fail)
            self.assertTrue(backup.exists())
