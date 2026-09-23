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
        self.ctx = quickjs.Context()
        self.ctx.set_memory_limit(768 * 1024 * 1024)
        self.ctx.add_callable('_sha256', digest)
        self.ctx.add_callable('_uuid', uid)
        self.ctx.add_callable('_utf8len', lambda value: len(value.encode('utf-8')))
        self.ctx.eval('globalThis.structuredClone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));globalThis.crypto={randomUUID:()=>_uuid()};globalThis.Buffer={byteLength:v=>_utf8len(v)};')
        self.ctx.eval((root / 'domain-bundle.js').read_text(encoding='utf-8'))
        self.invoke = self.ctx.eval('(name,args)=>{try{return JSON.stringify({value:Domain[name](...JSON.parse(args))});}catch(e){return JSON.stringify({error:e.message,status:e.status||400});}}')

    def _call(self, name, arguments):
        result = json.loads(self.invoke(name, dumps(arguments)))
        if 'error' in result:
            raise AppError(result['error'], result.get('status', 400))
        return result.get('value')

    def __call__(self, name, *args):
        return self.executor.submit(self._call, name, args).result()

    def close(self):
        self.executor.shutdown(wait=True)
