"""Create an internal colleague package from a data-free public release ZIP."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from release_config import PREFIX, read_config


def package_colleague(source, config_app, output):
    source, output = Path(source), Path(output)
    config = read_config(config_app)
    keys = ('envId', 'region', 'functionName', 'accessKey')
    # Copy only client routing, never arbitrary local environment variables.
    config_bytes = (PREFIX + json.dumps({k: config[k] for k in keys}, ensure_ascii=False) + '\n').encode('utf-8')
    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        roots = {name.split('/')[0] for name in names}
        if len(roots) != 1:
            raise ValueError('分发包目录结构不正确')
        root = roots.pop()
        config_name = root + '/_internal/web/.env.local'
        manifest_name = root + '/SHA256SUMS.txt'
        if names.count(config_name) != 1 or names.count(manifest_name) != 1 or len(set(names)) != len(names):
            raise ValueError('登录配置或校验清单缺失或重复')
        for name in names:
            relative = name[len(root) + 1:]
            if '..' in relative.split('/') or '\\' in relative or relative.startswith('/'):
                raise ValueError('分发包包含非法路径')
            if relative.startswith(('data/', 'runtime/')) or '.sqlite' in relative.lower() or relative.endswith(('state.json', '.db')):
                raise ValueError('分发包包含本机数据')
        payload = {name: archive.read(name) for name in names if not name.endswith('/')}
    for row in payload[manifest_name].decode('utf-8').splitlines():
        checksum, relative = row.split('  ', 1)
        if hashlib.sha256(payload[root + '/' + relative]).hexdigest() != checksum:
            raise ValueError('原分发包校验失败：' + relative)
    payload[config_name] = config_bytes
    payload[root + '/新用户使用说明.txt'] = ('此包供内部新用户使用，已配置正式云端登录。\n完整解压后运行 EXE，使用已开通的成员账号登录。\n不含业务数据、账号密码或登录缓存。请勿作为公开 Release 附件上传。\n').encode('utf-8')
    payload[manifest_name] = ('\n'.join(hashlib.sha256(raw).hexdigest() + '  ' + name[len(root) + 1:] for name, raw in payload.items() if name != manifest_name) + '\n').encode('utf-8')
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in payload.items():
            archive.writestr(name, raw)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert archive.read(config_name) == config_bytes
    return dict(archive=str(output.resolve()), bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest(), clientConfigIncluded=True, userDataIncluded=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('config_app', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(json.dumps(package_colleague(args.source, args.config_app, args.output), ensure_ascii=False))
