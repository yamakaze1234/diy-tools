"""Build a distributable Python app without any user data or credentials."""
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = '1.0.5'


def build():
    subprocess.run(['node', str(ROOT / 'build-web.mjs')], check=True)
    # Every build has an isolated output directory; PyInstaller never cleans a
    # previous user deliverable in place. Superseded stages can be recycled later.
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    dist = ROOT.parent / 'release' / ('python-' + VERSION + '-' + stamp)
    name = 'DIY配置工作台-v' + VERSION
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--windowed', '--onedir', '--name', name,
        '--distpath', str(dist), '--workpath', str(ROOT / 'build' / stamp), '--specpath', str(ROOT / 'build' / stamp),
        '--icon', str(ROOT / 'web/assets/workbench-icon-v1.ico'), '--add-data', str(ROOT / 'web') + ';web',
        '--add-data', str(ROOT / 'domain-bundle.js') + ';.', '--collect-all', 'webview', '--hidden-import', '_quickjs', '--collect-all', 'pytds',
        '--exclude-module', 'tkinter', '--exclude-module', 'PyQt5', '--exclude-module', 'PyQt6', '--exclude-module', 'PySide6',
        str(ROOT / 'main.py')], check=True)
    (ROOT / 'verification').mkdir(exist_ok=True)
    (ROOT / 'verification' / 'latest-build.json').write_text(json.dumps(dict(version=VERSION, directory=str(dist / name), executable=str(dist / name / (name + '.exe'))), ensure_ascii=False, indent=2), encoding='utf-8')
    print(dist, flush=True)


if __name__ == '__main__':
    build()
