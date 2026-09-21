"""Smoke-check the packaged backend using synthetic data and no cloud login."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import requests

ROOT = Path(__file__).resolve().parents[1]
build = json.loads((ROOT / 'verification/latest-build.json').read_text(encoding='utf-8'))
app = Path(build['directory'])
# Validate the shipped rules, not only the source bundle or unauthenticated HTTP
# routes: an old bundle can start successfully but fail during synchronization.
sys.path.insert(0, str(ROOT))
from domain import Domain
rules = Domain(app / '_internal')
try:
    state = rules('initializeActualParts', {'configs': [
        {'parts': [{'goodsId': '123', 'qty': 2}]},
        {'parts': [{'goodsId': '456', 'qty': 1}], 'actualParts': []},
    ]})
    assert state['configs'][0]['actualParts'] == state['configs'][0]['parts']
    assert state['configs'][1]['actualParts'] == []
finally:
    rules.close()
stage = Path(tempfile.mkdtemp(prefix='packaged-headless-', dir=ROOT / '.verification'))
data = stage / 'data'
data.mkdir()
(data / 'state.json').write_bytes((ROOT / 'tests/fixtures/state.json').read_bytes())
environment = dict(os.environ, DIY_WORKBENCH_DATA_DIR=str(data), DIY_WORKBENCH_USER_DATA=str(data / 'runtime'),
                   PATH=str(Path(os.environ['SystemRoot']) / 'System32'))
for key in ('PYTHONHOME', 'PYTHONPATH', 'DIY_WORKBENCH_DEBUG_PORT'):
    environment.pop(key, None)
process = subprocess.Popen([build['executable'], '--headless', '--port', '0'], env=environment,
                           creationflags=subprocess.CREATE_NO_WINDOW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    runtime_file = data / 'runtime/desktop-runtime.json'
    deadline = time.monotonic() + 30
    while not runtime_file.exists():
        if process.poll() is not None:
            raise RuntimeError(f'Packaged backend exited: {process.returncode}')
        if time.monotonic() >= deadline:
            raise RuntimeError('Packaged backend startup timeout')
        time.sleep(.1)
    runtime = json.loads(runtime_file.read_text(encoding='utf-8'))
    assert runtime['version'] == build['version']
    assert runtime['pid'] == process.pid
    base = f"http://127.0.0.1:{runtime['port']}"
    assert requests.get(base + '/api/workspace-sync/config', timeout=5).status_code == 200
    assert requests.get(base + '/api/state', timeout=5).status_code == 401
    assert requests.post(base + '/api/workspace-sync/local-history', json={}, timeout=5).status_code == 403
    with sqlite3.connect((data / 'workspace.sqlite').as_uri() + '?mode=ro', uri=True) as db:
        assert db.execute("SELECT count(*) FROM sqlite_master WHERE name='local_changes'").fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM local_changes').fetchone()[0] == 0
        assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    fixture = json.loads((ROOT / 'tests/fixtures/state.json').read_text(encoding='utf-8'))
    actual = json.loads((data / 'state.json').read_text(encoding='utf-8'))
    assert len(actual['configs']) == len(fixture['configs'])
    checked = []
    for source in (ROOT.parent / 'prototype').iterdir():
        if source.is_file() and source.suffix in ('.js', '.css', '.html'):
            assert source.read_bytes() == (app / '_internal/web' / source.name).read_bytes(), source.name
            checked.append(source.name)
    report = dict(version=build['version'], executable=build['executable'],
                  sha256=hashlib.sha256(Path(build['executable']).read_bytes()).hexdigest(),
                  isolatedData=str(data), noPythonOrNodeOnPath=True, startup=True, loginGate=True,
                  csrfGate=True, localHistorySchema=True, fixturePreserved=True,
                  uiSourceFilesIdentical=len(checked), packagedSyncRules=True,
                  cloudLoginPerformed=False, visualReview=False)
    (ROOT / 'verification' / f"packaged-headless-{build['version']}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
finally:
    if process.poll() is None:
        process.terminate()  # Only this isolated, unauthenticated smoke-test process.
    process.wait(timeout=10)
