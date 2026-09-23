"""Restore this computer's CloudBase settings after creating a public ZIP."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path


def config_file(app: Path) -> Path:
    if not any(app.glob('DIY配置工作台-v*.exe')):
        raise ValueError(f'不是工作台程序文件夹: {app}')
    path = app / '_internal' / 'web' / '.env.local'
    if not path.is_file():
        raise ValueError(f'缺少登录配置: {path}')
    return path


def parsed_config(raw: bytes) -> dict:
    for line in raw.decode('utf-8-sig').splitlines():
        if line.startswith('CLOUDBASE_PUBLIC_CONFIG='):
            value = json.loads(line.split('=', 1)[1])
            if value.get('envId') and value.get('accessKey') and value.get('functionName') == 'workbenchApi':
                return value
    raise ValueError('旧版登录配置不完整')


def restore(previous: Path, current: Path) -> None:
    previous = previous.resolve()
    current = current.resolve()
    source = config_file(previous)
    target = config_file(current)
    if source == target:
        raise ValueError('旧版和新版不能是同一文件夹')
    source_bytes = source.read_bytes()
    template = (Path(__file__).resolve().parent.parent / 'prototype' / '.env.example').read_bytes()
    if source_bytes == template:
        raise ValueError('旧版仍是分发模板，没有可沿用的登录配置')
    parsed_config(source_bytes)
    existing = target.read_bytes()
    if existing not in (template, source_bytes):
        raise ValueError('新版已有不同的登录配置，未覆盖')
    manifest = current / 'SHA256SUMS.txt'
    if manifest.is_file():
        lines = manifest.read_text(encoding='utf-8').splitlines()
        suffix = '  _internal/web/.env.local'
        matches = [i for i, line in enumerate(lines) if line.endswith(suffix)]
        if len(matches) != 1:
            raise ValueError('校验清单中的登录配置条目异常')
    if existing != source_bytes:
        shutil.copy2(source, target)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if digest != hashlib.sha256(source_bytes).hexdigest():
        raise RuntimeError('登录配置复制校验失败')

    if manifest.is_file():
        lines[matches[0]] = digest + suffix
        manifest.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('本机登录配置已沿用旧版并校验；分发 ZIP 未改动。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('previous', type=Path, help='旧版程序文件夹')
    parser.add_argument('current', type=Path, help='新版程序文件夹')
    args = parser.parse_args()
    restore(args.previous, args.current)
