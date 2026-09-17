"""Isolated desktop test launcher. Never included in the distribution."""
import json
import sys
import threading
import time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import main
from service import Service
from common import now

records = json.loads((ROOT / 'tests/fixtures/records.json').read_text(encoding='utf-8'))
records += [dict(type='workspace_meta', id='root', data=dict(format=2))]
changes = [dict(**r, seq=i+1, version=1, updatedAt=now(), updatedBy='synthetic') for i, r in enumerate(records)]
mutation_results = {}
guard = threading.Lock()


def cloud(request, token):
    with guard:
        action = request['action']
        if action == 'session.get':
            return dict(ok=True, uid=token, memberId=token, workspaceId='synthetic-team', name='测试成员 ' + token, ready=True)
        if action == 'sync.pull':
            cursor = request['payload']['cursor']
            head = request['payload'].get('headSeq', len(changes))
            page = changes[cursor:min(head, cursor+100)]
            return dict(ok=True, changes=page, headSeq=head, nextCursor=cursor+len(page), hasMore=cursor+len(page)<head)
        if action == 'sync.pushBatch':
            results = []
            for item in request['payload']['requests']:
                p = item['payload']
                key = p['mutationId']
                if key not in mutation_results:
                    row = dict(type=p['entityType'], id=p['entityId'], data=p['after'], version=p['baseVersion']+1, seq=len(changes)+1, updatedAt=now(), updatedBy=token)
                    changes.append(row)
                    mutation_results[key] = dict(ok=True, record=row)
                results.append(mutation_results[key])
            return dict(ok=True, results=results)
        raise RuntimeError('Unexpected synthetic action')


def sql(*_):
    time.sleep(0.5)
    return dict(warehouses=[{'goods_id': '123', '库房': '公司大库', '商品编码': 'SKU123', '商品名称': 'ERP 原名', '分库数': 9, '分库待入': 0, '分库可销数': 8, '库存成本': 99.25}], catalog=[{'goods_id': '123', '商品编码': 'SKU123', '商品名称': 'ERP 原名'}])


main.Service = lambda root, local: Service(root, local, transport=cloud, sql_reader=sql)
main.run()
