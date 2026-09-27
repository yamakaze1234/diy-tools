"""Measure local save paths on a private copy of an immutable backup.

No production database, credential file, network or ERP connection is used.
The caller retains the generated isolated directory until reviewed/recycled.
"""
import argparse
import collections
import copy
import hashlib
import importlib
import json
from pathlib import Path
import sqlite3
import statistics
import sys
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--python-source', required=True)
    parser.add_argument('--domain-root', required=True)
    parser.add_argument('--backup-data', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--mode', choices=['full', 'batch'], default='full')
    parser.add_argument('--rounds', type=int, default=3)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    backup = Path(args.backup_data).resolve()
    local = Path(tempfile.mkdtemp(prefix='save-benchmark-', dir=output.parent))
    source_hash = hashlib.sha256((backup / 'state.json').read_bytes()).hexdigest()
    (local / 'state.json').write_bytes((backup / 'state.json').read_bytes())
    reader = sqlite3.connect((backup / 'workspace.sqlite').as_uri() + '?mode=ro', uri=True)
    writer = sqlite3.connect(local / 'workspace.sqlite')
    reader.backup(writer)
    reader.close()
    writer.close()
    (local / 'python-backend-migration.json').write_text('{}', encoding='utf-8')
    sys.path.insert(0, str(Path(args.python_source).resolve()))
    Service = importlib.import_module('service').Service
    dumps = importlib.import_module('common').dumps

    def forbidden_network(*_):
        raise AssertionError('Benchmark network access is forbidden')

    service = Service(Path(args.domain_root).resolve(), local, transport=forbidden_network)
    service.cloud.paused = True
    service.cloud.token = service.cloud.cookie = 'isolated-benchmark'
    service.cloud.expires = time.time() + 3600
    service.cloud.member = dict(uid='benchmark', memberId='benchmark', name='isolated benchmark', workspaceId='benchmark')
    metrics = collections.defaultdict(lambda: dict(calls=0, seconds=0))
    original_domain = service.domain

    class TimedDomain:
        def __call__(self, name, *arguments):
            started = time.perf_counter()
            try:
                return original_domain(name, *arguments)
            finally:
                metrics[name]['calls'] += 1
                metrics[name]['seconds'] += time.perf_counter() - started

        def close(self):
            original_domain.close()

    service.domain = service.store.domain = service.history.domain = TimedDomain()
    rounds = []
    try:
        groups = collections.Counter((c['shopId'], c.get('productId')) for c in service.state['configs'] if not c.get('deletedAt'))
        group, count = groups.most_common(1)[0]
        for index in range(args.rounds):
            before = copy.deepcopy(service.state)
            changed = []
            for config in before['configs']:
                if config.get('deletedAt') or (config['shopId'], config.get('productId')) != group:
                    continue
                after = copy.deepcopy(config)
                for field in ('parts', 'actualParts'):
                    if after.get(field):
                        after[field][0]['qty'] = int(after[field][0].get('qty', 1)) + 1
                changed.append(dict(id=config['id'], before=config, after=after))
            if args.mode == 'full':
                incoming = copy.deepcopy(before)
                by_id = {change['id']: change['after'] for change in changed}
                incoming['configs'] = [by_id.get(c['id'], c) for c in incoming['configs']]
                incoming.update(baseRevision=before['revision'], baseState=before, message='链接内批量修改配件：隔离性能测试')
                invoke = service.update_state
            else:
                # Keep this adapter explicit and synchronized with the reviewed API.
                incoming = dict(operationId=str(uuid.uuid4()),baseRevision=before['revision'],
                                changes=[dict(id=c['id'],base=c['before'],after=c['after']) for c in changed],
                                message='链接内批量修改配件：隔离性能测试')
                invoke = service.update_configs_batch
            request_bytes = len(dumps(incoming).encode('utf-8'))
            metrics.clear()
            started = time.perf_counter()
            receipt = invoke(incoming, 'diy_session=isolated-benchmark')
            elapsed = time.perf_counter() - started
            response_bytes = len(dumps(receipt).encode('utf-8'))
            desired = {change['id']: change['after'] for change in changed}
            actual = {c['id']: c for c in service.state['configs']}
            for key, expected in desired.items():
                for field in ('parts', 'actualParts'):
                    if expected.get(field):
                        assert actual[key][field][0]['qty'] == expected[field][0]['qty']
            for config in before['configs']:
                if config['id'] not in desired:
                    assert actual[config['id']] == config, 'Unselected configuration changed'
            result = dict(round=index + 1, modified=len(changed), requestBytes=request_bytes,
                          responseBytes=response_bytes, backendSeconds=elapsed,
                          domainCalls=sum(x['calls'] for x in metrics.values()),
                          timingsInclusive=dict(metrics))
            rounds.append(result)
            print(json.dumps({k: v for k, v in result.items() if k != 'timingsInclusive'}), flush=True)
        assert source_hash == hashlib.sha256((backup / 'state.json').read_bytes()).hexdigest()
        report = dict(mode=args.mode, isolatedCopy=str(local), backupStateSha256=source_hash,
                      productionWrites=False, configs=len(service.state['configs']),
                      rounds=rounds, medianBackendSeconds=statistics.median(r['backendSeconds'] for r in rounds))
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(dict(report=str(output), medianBackendSeconds=report['medianBackendSeconds'])), flush=True)
    finally:
        service.close()


if __name__ == '__main__':
    main()
