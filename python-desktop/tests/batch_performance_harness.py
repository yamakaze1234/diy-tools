"""Launch a real isolated window against an immutable backup, without cloud I/O."""
import json
import os
from pathlib import Path
import sqlite3
import sys

source = Path(os.environ['DIY_BENCH_PYTHON_SOURCE']).resolve()
rules = Path(os.environ['DIY_BENCH_DOMAIN_ROOT']).resolve()
backup = Path(os.environ['DIY_BENCH_BACKUP_DATA']).resolve()
local = Path(os.environ['DIY_WORKBENCH_DATA_DIR']).resolve()
assert not local.exists(), 'Must use a fresh isolated directory'
assert local != backup and not local.is_relative_to(backup)
local.mkdir(parents=True)
(local / 'state.json').write_bytes((backup / 'state.json').read_bytes())
reader = sqlite3.connect((backup / 'workspace.sqlite').as_uri() + '?mode=ro', uri=True)
writer = sqlite3.connect(local / 'workspace.sqlite')
reader.backup(writer)
reader.close()
writer.close()
(local / 'python-backend-migration.json').write_text('{}', encoding='utf-8')
sys.path.insert(0, str(source))
sys._MEIPASS = str(rules)
import main
from service import Service


def isolated_service(root, directory):
    holder = {}

    def transport(request, token):
        if request['action'] != 'session.get':
            raise AssertionError('Cloud calls forbidden in performance UI test')
        store = holder['service'].store
        return dict(ok=True, uid=store.meta('uid') or token,
                    workspaceId=store.meta('workspaceId') or 'benchmark',
                    memberId='isolated-benchmark', name='隔离性能测试', ready=True)

    service = Service(root, directory, transport=transport)
    service.cloud.paused = True
    holder['service'] = service
    return service


main.Service = isolated_service
main.run()
