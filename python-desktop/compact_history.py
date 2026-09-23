"""Offline, verified conversion of legacy JSON history into compressed snapshots."""
import argparse
import hashlib
import os
import sqlite3
import zlib
from datetime import datetime, timezone
from pathlib import Path


def convert(source: Path):
    source = source.resolve()
    if not source.is_file() or source.name != 'versions.sqlite':
        raise RuntimeError('Expected an existing versions.sqlite')
    if any(source.with_name(source.name + suffix).exists() for suffix in ('-wal', '-shm')):
        raise RuntimeError('Close the workbench and checkpoint SQLite before conversion')
    stage = source.with_name('versions.compacted.sqlite')
    if stage.exists():
        raise RuntimeError(f'Staging file already exists: {stage}')
    reader = sqlite3.connect(f'{source.as_uri()}?mode=ro', uri=True)
    writer = None
    try:
        if reader.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Source database integrity check failed')
        writer = sqlite3.connect(stage)
        writer.executescript('''CREATE TABLE versions(id TEXT PRIMARY KEY,scope TEXT NOT NULL,at TEXT NOT NULL,
            revision INTEGER NOT NULL,reason TEXT NOT NULL,hash TEXT NOT NULL,content BLOB NOT NULL,
            encoding TEXT NOT NULL DEFAULT 'zlib',name TEXT,pinned INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE history_maintenance(key TEXT PRIMARY KEY,value TEXT NOT NULL);''')
        columns = {r[1] for r in reader.execute('PRAGMA table_info(versions)')}
        optional = ('encoding' if 'encoding' in columns else "'json'") + ',' + ('name' if 'name' in columns else 'NULL') + ',' + ('pinned' if 'pinned' in columns else '0')
        count = 0
        for row in reader.execute(f'SELECT rowid,id,scope,at,revision,reason,hash,content,{optional} FROM versions ORDER BY rowid'):
            rowid, key, scope, at, revision, reason, hashed, content, encoding, name, pinned = row
            raw = zlib.decompress(content) if encoding == 'zlib' else content.encode('utf-8') if isinstance(content, str) else bytes(content)
            if hashlib.sha256(raw).hexdigest() != hashed:
                raise RuntimeError(f'History hash mismatch at rowid {rowid}')
            packed = zlib.compress(raw, 6)
            if zlib.decompress(packed) != raw:
                raise RuntimeError(f'Compression roundtrip failed at rowid {rowid}')
            writer.execute('INSERT INTO versions(rowid,id,scope,at,revision,reason,hash,content,encoding,name,pinned) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                           (rowid,key,scope,at,revision,reason,hashed,packed,'zlib',name,pinned))
            count += 1
        for key,value in reader.execute('SELECT key,value FROM history_maintenance'):
            writer.execute('INSERT INTO history_maintenance VALUES(?,?)',(key,value))
        timestamp=datetime.now(timezone.utc).isoformat()
        for key in ('weekly_policy_started','last_cleanup'):
            writer.execute('INSERT OR REPLACE INTO history_maintenance VALUES(?,?)',(key,timestamp))
        writer.commit()
        if writer.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Converted database integrity check failed')
        if writer.execute('SELECT count(*) FROM versions').fetchone()[0] != count:
            raise RuntimeError('Converted version count mismatch')
        writer.close(); writer=None
        reader.close(); reader=None
        backup = source.with_name('versions.before-compression.sqlite')
        if backup.exists():
            raise RuntimeError(f'Backup already exists: {backup}')
        os.replace(source, backup)
        try:
            os.replace(stage, source)
        except BaseException:
            os.replace(backup, source)
            raise
        return dict(records=count, beforeBytes=backup.stat().st_size, afterBytes=source.stat().st_size, backup=str(backup))
    finally:
        if writer is not None: writer.close()
        if reader is not None: reader.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database',type=Path)
    args=parser.parse_args()
    print(convert(args.database))
