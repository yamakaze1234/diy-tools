"""Synthetic cloud, local HTTP backend; never contacts production services."""
import json
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import main
from service import Service
from common import atomic, dumps, now


def service(root, local):
    records = json.loads((ROOT / 'tests/fixtures/records.json').read_text(encoding='utf-8'))
    records.append(dict(type='workspace_meta', id='root', data=dict(format=2)))
    changes = [dict(**r, seq=i+1, version=1, updatedAt=now(), updatedBy='synthetic') for i, r in enumerate(records)]
    receipts, calls = {}, []
    lock = threading.Lock()

    def transport(request, token):
        with lock:
            action, p = request['action'], request['payload']
            calls.append(action)
            atomic(Path(local) / 'synthetic-cloud-calls.json', dumps(calls))
            if action == 'session.get':
                return dict(ok=True, uid=token, memberId=token, workspaceId='synthetic-team', name='测试成员', ready=True)
            if action == 'sync.pull':
                cursor, head = p['cursor'], p.get('headSeq', len(changes))
                page = changes[cursor:min(head, cursor+100)]
                return dict(ok=True, changes=page, headSeq=head, nextCursor=cursor+len(page), hasMore=cursor+len(page)<head)
            if action == 'sync.pushBatch':
                results = []
                for request in p['requests']:
                    value = request['payload']
                    key = value['mutationId']
                    if key not in receipts:
                        row = dict(type=value['entityType'], id=value['entityId'], data=value['after'], version=value['baseVersion']+1, seq=len(changes)+1, updatedAt=now(), updatedBy='synthetic')
                        changes.append(row)
                        receipts[key] = dict(ok=True, record=row)
                    results.append(receipts[key])
                return dict(ok=True, results=results)
            raise AssertionError('Unexpected synthetic request: ' + action)

    result = Service(root, local, transport=transport)
    # Asset transport is outside this scheduler/UI test; use only local fixtures.
    result.cloud.upload_assets = lambda *_: None
    return result


main.Service = service
main.run()
