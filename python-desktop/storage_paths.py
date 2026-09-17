"""Portable defaults and non-destructive import from the former AppData location."""
import json
import os
import shutil
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from common import atomic, dumps, now, uid


@dataclass(frozen=True)
class StoragePaths:
    app: Path
    data: Path
    profile: Path
    legacy_profile: Path | None
    import_legacy: bool


def storage_paths(env=None, *, frozen=None, executable=None, source=None):
    env = os.environ if env is None else env
    frozen = getattr(sys, 'frozen', False) if frozen is None else frozen
    app = (Path(executable or sys.executable).parent if frozen else Path(source or __file__).parent).resolve()
    data = Path(env.get('DIY_WORKBENCH_DATA_DIR') or app / 'data').resolve()
    profile = Path(env.get('DIY_WORKBENCH_USER_DATA') or data / 'runtime').resolve()
    legacy = Path(env['APPDATA']).resolve() / 'DIYWorkbench' if env.get('APPDATA') else None
    return StoragePaths(app, data, profile, legacy, not any(env.get(k) for k in ('DIY_WORKBENCH_DATA_DIR', 'DIY_WORKBENCH_USER_DATA')))


def ensure_legacy_closed(profile):
    runtime = profile / 'desktop-runtime.json'
    port = 4179
    if runtime.exists():
        try:
            port = int(json.loads(runtime.read_text(encoding='utf-8'))['port'])
        except (ValueError, KeyError, TypeError):
            pass
    if not 1 <= port <= 65535:
        return
    import requests
    try:
        response = requests.get(f'http://127.0.0.1:{port}/api/workspace-sync/config', timeout=1)
        if response.ok and 'csrf' in response.json():
            raise RuntimeError('旧版工作台仍在运行，请先正常退出，再迁移到程序文件夹。旧数据保持不变。')
    except (requests.RequestException, ValueError):
        pass


def copy_data(source, target):
    target.mkdir()
    # SQLite backup includes committed WAL content, rather than copying a stale db.
    for item in source.iterdir():
        if item.is_symlink() or item.is_junction():
            raise RuntimeError('旧数据目录存在外部链接，请先核对后再迁移。')
        destination = target / item.name
        if item.name.endswith(('.sqlite-wal', '.sqlite-shm')):
            continue
        if item.is_dir():
            copy_data(item, destination)
        elif item.suffix == '.sqlite':
            reader = sqlite3.connect(item.as_uri() + '?mode=ro', uri=True)
            writer = sqlite3.connect(destination)
            try:
                reader.backup(writer)
                if writer.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise RuntimeError('旧数据库校验失败，原数据保持不变。')
            finally:
                writer.close()
                reader.close()
        else:
            shutil.copy2(item, destination)


def prepare_storage(paths, check_closed=ensure_legacy_closed):
    imported = False
    source = paths.legacy_profile / 'data' if paths.legacy_profile else None
    # Any pre-existing destination belongs to this portable copy. Never merge or
    # overwrite it with another workspace, including an intentionally empty folder.
    if paths.import_legacy and not paths.data.exists() and source and source.is_dir() and any((source / name).exists() for name in ('state.json', 'workspace.sqlite', 'versions.sqlite')):
        check_closed(paths.legacy_profile)
        paths.data.parent.mkdir(parents=True, exist_ok=True)
        stage = paths.data.with_name('.data-migration-' + uid())
        copy_data(source, stage)
        # Preserve only the DPAPI-wrapped key needed to read legacy SQL envelopes;
        # the old browser profile and login cookies are not copied.
        local_state = paths.legacy_profile / 'Local State'
        if local_state.exists():
            encrypted_key = json.loads(local_state.read_text(encoding='utf-8')).get('os_crypt', {}).get('encrypted_key')
            if encrypted_key:
                atomic(stage / 'sql-credentials' / 'legacy-os-crypt.json', dumps(dict(encrypted_key=encrypted_key)))
        atomic(stage / 'portable-migration.json', dumps(dict(version=1, at=now(), source=str(source), destination=str(paths.data), originalPreserved=True)))
        # The stage becomes visible as data only after every copy succeeds.
        stage.rename(paths.data)
        imported = True
    try:
        paths.data.mkdir(parents=True, exist_ok=True)
        paths.profile.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise RuntimeError('程序文件夹不可写，请把整个工具文件夹放到可写位置后重试。数据不会改存到 AppData。') from error
    return imported
