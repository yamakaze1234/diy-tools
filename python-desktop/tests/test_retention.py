import unittest
import tempfile
from pathlib import Path
from datetime import datetime, timedelta, timezone
from store import History

class RetentionTests(unittest.TestCase):
    def test_weekly_cleanup_preserves_30_days_and_latest_per_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            history=History(Path(directory)/'versions.sqlite',None)
            try:
                for scope in ['a','b']:
                    for revision in range(3):
                        history.record(dict(revision=revision),scope,'测试')
                current=datetime.now(timezone.utc)
                old=(current-timedelta(days=31)).isoformat()
                history.db.execute('UPDATE versions SET at=?',(old,))
                recent_id=history.db.execute("SELECT id FROM versions WHERE scope='a' AND revision=1").fetchone()[0]
                history.db.execute('UPDATE versions SET at=? WHERE id=?',((current-timedelta(days=29)).isoformat(),recent_id))
                history.db.execute('DELETE FROM history_maintenance')
                self.assertEqual(history.prune(current),3)
                self.assertEqual(history.db.execute('SELECT count(*) FROM versions').fetchone()[0],3)
                self.assertEqual(history.prune(current+timedelta(days=6)),0)
                self.assertEqual(history.prune(current+timedelta(days=7)),1)
                self.assertEqual(history.db.execute('SELECT count(*) FROM versions').fetchone()[0],2)
            finally:
                history.close()
