"""Package only application files, never the portable user's data directory."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def package():
    build = json.loads((ROOT / 'verification/latest-build.json').read_text(encoding='utf-8'))
    app = Path(build['directory'])
    exe = Path(build['executable'])
    # Explicit allowlist: data/runtime, credentials, databases and other files
    # created by a running portable application cannot enter future distributions.
    files = [exe] + sorted(p for p in (app / '_internal').rglob('*') if p.is_file())
    seed = json.loads((app / '_internal/web/seed.json').read_text(encoding='utf-8'))
    assert all(not seed[k] for k in ('configs', 'templates', 'sourceCatalog', 'costSource', 'caseGallery', 'logs'))
    assert not any(p.suffix == '.sqlite' or p.name == 'state.json' for p in files)
    guide = app / '使用说明.txt'
    shutil.copy2(ROOT / '使用说明.txt', guide)
    files.append(guide)
    installer = app / 'MicrosoftEdgeWebview2Setup.exe'
    if not installer.exists():
        candidates = list((ROOT.parent / 'release').glob('python-*/DIY配置工作台-Python-*/MicrosoftEdgeWebview2Setup.exe'))
        if not candidates:
            raise RuntimeError('Missing Microsoft WebView2 bootstrapper')
        shutil.copy2(candidates[0], installer)
    files.append(installer)
    manifest = app / 'SHA256SUMS.txt'
    manifest.write_text('\n'.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.relative_to(app).as_posix() for p in files) + '\n', encoding='utf-8')
    files.append(manifest)
    archive = ROOT.parent / 'release' / f"DIY配置工作台-Python-{build['version']}-其他电脑使用.zip"
    if archive.exists():
        raise RuntimeError('使用包已存在，请先保留或移入回收站后再生成。')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file in files:
            z.write(file, (Path(app.name) / file.relative_to(app)).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert not any(name.startswith(app.name + '/data/') for name in z.namelist())
    result = dict(version=build['version'], archive=str(archive), archiveBytes=archive.stat().st_size, archiveSHA256=hashlib.sha256(archive.read_bytes()).hexdigest(), files=len(files), defaultDataDirectory='EXE directory/data', userDataIncluded=False)
    (ROOT / 'verification' / ('release-' + build['version'] + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    package()
