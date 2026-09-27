"""Reuse tested pure JS business rules; all I/O and scheduling belong to Python.

The engine has no browser, Node, filesystem or network bindings. A single dedicated
thread owns its context, keeping cross-thread calls safe and off the window thread.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from common import dumps, digest, uid, AppError


class Domain:
    def __init__(self, root=None):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='business-rules')
        self.executor.submit(self._init, Path(root or __file__).parent if root is None else Path(root)).result()

    def _init(self, root):
        import quickjs
        import hashlib
        self.ctx = quickjs.Context()
        self.ctx.set_memory_limit(768 * 1024 * 1024)
        self.ctx.add_callable('_sha256', digest)
        hashers = {}
        def hash_start():
            key = uid()
            hashers[key] = hashlib.sha256()
            return key
        def hash_update(key, value):
            hashers[key].update(value.encode('utf-8'))
        def hash_finish(key):
            return hashers.pop(key).hexdigest()
        self.ctx.add_callable('_sha256_start', hash_start)
        self.ctx.add_callable('_sha256_update', hash_update)
        self.ctx.add_callable('_sha256_finish', hash_finish)
        self.ctx.add_callable('_uuid', uid)
        self.ctx.add_callable('_utf8len', lambda value: len(value.encode('utf-8')))
        self.ctx.eval('globalThis.structuredClone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));globalThis.crypto={randomUUID:()=>_uuid()};globalThis.Buffer={byteLength:v=>_utf8len(v)};')
        self.ctx.eval((root / 'domain-bundle.js').read_text(encoding='utf-8'))
        self.invoke = self.ctx.eval('(name,args)=>{try{return JSON.stringify({value:Domain[name](...JSON.parse(args))});}catch(e){return JSON.stringify({error:e.message,status:e.status||400});}}')

    def _call(self, name, arguments):
        # These transforms retain activity unchanged. Keep bulky history on the
        # Python side instead of parsing, cloning and serializing it in QuickJS.
        retained_logs = None
        retain_logs = name in {'normalizeWorkspaceState', 'applyWorkspace', 'initializeMaterializedState'} and arguments and isinstance(arguments[0], dict) and 'logs' in arguments[0]
        if retain_logs:
            retained_logs = arguments[0]['logs']
            arguments = ({**arguments[0], 'logs': []}, *arguments[1:])
        payload = dumps(arguments)
        # Large snapshots need explicit collection. Tiny validators/activity calls
        # must not scan the entire retained heap twice per record.
        collect = len(payload) >= 1024 * 1024
        if collect:
            self.ctx.gc()
        try:
            result = json.loads(self.invoke(name, payload))
        finally:
            if collect:
                self.ctx.gc()
        if 'error' in result:
            raise AppError(result['error'], result.get('status', 400))
        value = result.get('value')
        if retain_logs and isinstance(value, dict):
            value['logs'] = retained_logs
        return value

    def __call__(self, name, *args):
        return self.executor.submit(self._call, name, args).result()

    def close(self):
        self.executor.shutdown(wait=True)
