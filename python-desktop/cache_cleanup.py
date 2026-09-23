"""Preview and recycle superseded, locally generated poster images."""
import ctypes
import hashlib
import os
import re
from pathlib import Path
from uuid import uuid4

IMAGE = re.compile(r'^(.+)_r(\d+)_(long|square)_(light|dark)\.png$')


def candidates(folder):
    folder = Path(folder)
    latest = {}
    groups = {}
    if not folder.is_dir():
        return []
    for file in folder.iterdir():
        if not file.is_file() or file.is_symlink():
            continue
        match = IMAGE.fullmatch(file.name)
        if not match:
            continue
        key = (match[1], match[3], match[4])
        revision = int(match[2])
        groups.setdefault(key, []).append((revision, file))
        if revision > latest.get(key, -1):
            latest[key] = revision
    return [file for key, group in groups.items() for revision, file in group if revision < latest[key]]


def preview(folder):
    files = candidates(folder)
    entries = sorted((file.name, file.stat().st_size) for file in files)
    signature = hashlib.sha256(repr(entries).encode('utf-8')).hexdigest()
    return dict(count=len(entries), bytes=sum(size for _, size in entries), signature=signature)


def recycle(path):
    if os.name != 'nt':
        raise RuntimeError('仅支持 Windows 回收站')

    class Operation(ctypes.Structure):
        _fields_ = [('hwnd', ctypes.c_void_p), ('wFunc', ctypes.c_uint),
                    ('pFrom', ctypes.c_wchar_p), ('pTo', ctypes.c_wchar_p),
                    ('fFlags', ctypes.c_ushort), ('fAnyOperationsAborted', ctypes.c_bool),
                    ('hNameMappings', ctypes.c_void_p), ('lpszProgressTitle', ctypes.c_wchar_p)]

    source = str(Path(path).resolve()) + '\0\0'
    operation = Operation(None, 3, source, None, 0x40 | 0x10 | 0x4 | 0x400, False, None, None)
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
    if result or operation.fAnyOperationsAborted:
        raise RuntimeError(f'移入回收站失败（{result}），缓存仍保留在程序数据目录')


def clear(folder, signature, recycler=recycle):
    folder = Path(folder)
    plan = preview(folder)
    if signature != plan['signature']:
        raise ValueError('缓存已变化，请重新预览')
    if not plan['count']:
        return dict(removed=0, bytes=0)
    files = candidates(folder)
    stage = folder / ('.cache-recycle-' + uuid4().hex)
    stage.mkdir()
    moved = []
    try:
        for file in files:
            destination = stage / file.name
            file.replace(destination)
            moved.append((file, destination))
        recycler(stage)
    except Exception:
        for original, destination in reversed(moved):
            if destination.exists():
                destination.replace(original)
        if stage.exists():
            stage.rmdir()
        raise
    return dict(removed=plan['count'], bytes=plan['bytes'])
