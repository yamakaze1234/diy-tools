"""Keep local CloudBase routing across releases without putting it in public ZIPs."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

PREFIX = 'CLOUDBASE_PUBLIC_CONFIG='


def validate_config(config):
    if not isinstance(config, dict):
        raise ValueError('云端配置格式不正确')
    for key in ('envId', 'region', 'functionName', 'accessKey'):
        value = config.get(key)
        if not isinstance(value, str) or not value.strip() or any(
            marker in value.lower() for marker in ('your-', 'your_', '<set_', 'placeholder')
        ):
            raise ValueError('正式云端配置缺失或仍为示例配置：' + key)
    return config


def read_config(app):
    app = Path(app)
    saved = app / 'data/cloudbase-public.json'
    if saved.exists():
        return validate_config(json.loads(saved.read_text(encoding='utf-8-sig')))
    text = (app / '_internal/web/.env.local').read_text(encoding='utf-8-sig')
    for line in text.splitlines():
        if line.startswith(PREFIX):
            return validate_config(json.loads(line[len(PREFIX):]))
    raise ValueError('未找到正式云端配置')


def configure_local_app(app, previous):
    app, previous = Path(app).resolve(), Path(previous).resolve()
    if app == previous:
        raise ValueError('新版与旧版目录必须不同')
    config = read_config(previous)
    # Existing portable data must be migrated by the upgrade step, not created
    # here: creating data early would interfere with its no-overwrite guard.
    target = app / '_internal/web/.env.local'
    target.write_text(PREFIX + json.dumps(config, ensure_ascii=False) + '\n', encoding='utf-8')
    if read_config(app) != config:
        raise ValueError('新版云端配置与旧版不一致，禁止切换快捷方式')
    manifest = app / 'SHA256SUMS.txt'
    if manifest.exists():
        rows = manifest.read_text(encoding='utf-8').splitlines()
        rows = [hashlib.sha256(target.read_bytes()).hexdigest() + '  _internal/web/.env.local'
                if row.endswith('  _internal/web/.env.local') else row for row in rows]
        manifest.write_text('\n'.join(rows) + '\n', encoding='utf-8')
    return dict(configured=True, matchesPrevious=True)


def verify_local_runtime(app):
    app = Path(app)
    expected = read_config(app)
    runtime = json.loads((app / 'data/runtime/desktop-runtime.json').read_text(encoding='utf-8'))
    with urlopen(f"http://127.0.0.1:{int(runtime['port'])}/api/workspace-sync/config", timeout=10) as response:
        actual = json.load(response).get('config')
    validate_config(actual)
    if actual != expected:
        raise ValueError('运行中的云端配置与本机正式配置不一致')
    return dict(version=runtime['version'], cloudConfigVerified=True)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('app', type=Path)
    parser.add_argument('--previous', type=Path)
    parser.add_argument('--verify-running', action='store_true')
    args = parser.parse_args()
    result = configure_local_app(args.app, args.previous) if args.previous else dict(configured=bool(read_config(args.app)))
    if args.verify_running:
        result.update(verify_local_runtime(args.app))
    print(json.dumps(result, ensure_ascii=False))
