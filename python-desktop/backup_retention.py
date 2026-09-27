"""Expire application-managed backup files; never scan user export folders."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from cache_cleanup import recycle


def prune_backups(local, store, at=None, recycler=recycle):
    current = at or datetime.now(timezone.utc)
    cutoff = current - timedelta(days=3)
    removed = store.db.execute(
        'DELETE FROM backups WHERE julianday(created_at)<=julianday(?)',
        (cutoff.isoformat(),)).rowcount
    root = Path(local).resolve()
    candidates = []
    for name in ('backups', 'recovery'):
        folder = root / name
        if folder.is_dir() and not folder.is_symlink() and not folder.is_junction():
            candidates.extend(folder.iterdir())
    candidates.extend(root.glob('before-*-migration-*.json'))
    candidates.extend(root.glob('versions.before-compression.sqlite'))
    for path in candidates:
        if path.is_symlink() or path.is_junction() or not path.resolve().is_relative_to(root):
            continue
        # A newly created migration backup can contain old copied file timestamps.
        timestamps = [max(path.stat().st_mtime, path.stat().st_ctime)]
        if path.is_dir():
            children = list(path.rglob('*'))
            if any(child.is_symlink() or child.is_junction() for child in children):
                continue
            timestamps.extend(max(child.stat().st_mtime, child.stat().st_ctime) for child in children)
        if max(timestamps) <= cutoff.timestamp():
            recycler(path)
            removed += 1
    return removed
