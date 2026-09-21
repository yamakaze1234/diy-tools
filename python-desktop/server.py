"""Loopback HTTP compatibility layer for the unchanged workbench frontend."""
import base64
import json
import mimetypes
import re
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote
from common import AppError, atomic, digest, dumps

CSP = "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.tcloudbasegateway.com https://*.tcloudbase.com https://*.cloudbase.net https://*.tencentcloudapi.com; object-src 'none'; base-uri 'self'; frame-src 'none'"


def create_server(service, port=0):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # URLs/body may carry credentials; never put requests in logs.

        def send(self, status, value, mime='application/json; charset=utf-8', headers=None):
            data = dumps(value).encode('utf-8') if mime.startswith('application/json') else value
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', CSP)
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def body(self):
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 40 * 1024 * 1024:
                    raise AppError('请求为空或超过 40MB')
                value = json.loads(self.rfile.read(length))
                if not isinstance(value, dict):
                    raise AppError('请求格式无效')
                return value
            except (ValueError, UnicodeError):
                raise AppError('请求格式无效') from None

        def do_GET(self):
            self.dispatch()

        def do_POST(self):
            self.dispatch()

        def do_OPTIONS(self):
            if self.path.startswith('/api/erp-bridge/') and self.headers.get('Origin') == 'https://cqzs.3cerp.com':
                self.send(204, b'', 'text/plain', {'Access-Control-Allow-Origin': 'https://cqzs.3cerp.com', 'Access-Control-Allow-Headers': 'Content-Type, X-DIY-Collector', 'Access-Control-Allow-Methods': 'POST, OPTIONS'})
            else:
                self.send(403, dict(error='来源不匹配'))

        def dispatch(self):
            try:
                if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
                    raise AppError('仅允许本机访问', 403)
                path = unquote(urlsplit(self.path).path)
                cookie = self.headers.get('Cookie', '')
                collector = path.startswith('/api/erp-bridge/')
                origin = self.headers.get('Origin')
                if self.command == 'POST' and not collector and origin and origin != f'http://{self.headers.get("Host")}':
                    raise AppError('来源不匹配', 403)
                if path.startswith('/api/workspace-sync/'):
                    return self.workspace(path.rsplit('/', 1)[1], cookie)
                if path == '/api/recovery-draft' and self.command == 'POST':
                    if not service.cloud.cookie or f'diy_session={service.cloud.cookie}' not in [v.strip() for v in cookie.split(';')]:
                        raise AppError('本机会话无效', 401)
                    data = self.body()
                    if not isinstance(data.get('state'), dict):
                        raise AppError('恢复草稿格式无效')
                    from common import uid
                    target = service.local / 'recovery' / ('draft-' + uid() + '.json')
                    target.parent.mkdir(exist_ok=True)
                    atomic(target, dumps(data['state']))
                    return self.send(200, dict(ok=True, file=str(target)))
                with service.lock:
                    if collector:
                        if not service.cloud.token:
                            raise AppError('请先登录工作台成员账号', 401)
                    elif path.lower().startswith(('/api/', '/uploads/', '/saved/')) or path.lower().endswith('.json'):
                        service.cloud.require_login(cookie)
                if path.startswith('/api/sql-sync/'):
                    return self.sql(path.rsplit('/', 1)[1], cookie)
                if path == '/api/state':
                    if self.command == 'POST':
                        return self.send(200, service.update_state(self.body(), cookie))
                    with service.lock:
                        state = {**service.state, 'logs': service.domain('recentActivity', service.state.get('logs', []))}
                    return self.send(200, state)
                if path == '/api/session':
                    return self.send(200, service.session)
                if path == '/api/products/standard' and self.command == 'GET':
                    with service.lock:
                        result = dict(revision=service.state['revision'], links=service.domain('standardProducts', service.state))
                    return self.send(200, result)
                if path == '/api/versions' and self.command == 'GET':
                    with service.lock:
                        result = dict(versions=service.history.list(service.scope()))
                    return self.send(200, result)
                if path == '/api/versions/preview' and self.command == 'POST':
                    data = self.body()
                    with service.lock:
                        result = service.history.preview(data.get('id'), service.scope(), service.state)
                    return self.send(200, result)
                if path == '/api/versions/restore' and self.command == 'POST':
                    return self.send(200, service.restore(self.body(), cookie))
                if path in ('/api/product-sync/status', '/api/product-sync/start', '/api/product-sync/cancel'):
                    action = path.rsplit('/', 1)[1]
                    if self.command != ('GET' if action == 'status' else 'POST'):
                        raise AppError('不支持此操作', 405)
                    data = self.body() if self.command == 'POST' else {}
                    with service.lock:
                        jobs = service.product_jobs
                        jobs.session(service.cloud.cookie)
                        result = jobs.start(data) if action == 'start' else jobs.cancel() if action == 'cancel' else jobs.status()
                    return self.send(200, result)
                if path in ('/api/erp-sync/status', '/api/erp-sync/start'):
                    data = self.body() if self.command == 'POST' else {}
                    with service.lock:
                        result = service.domain('erpJob', 'start' if path.endswith('/start') else 'status', None, service.state.get('erpSync'))
                        if path.endswith('/start'):
                            service.domain('erpJob', 'operator', service.actor(data.get('operator')), service.state.get('erpSync'))
                        result['lastSuccess'] = service.state.get('erpSync')
                    return self.send(200, result)
                if collector:
                    if self.command != 'POST' or self.headers.get('X-DIY-Collector') != 'workbench-erp-v1' or origin not in (None, 'https://cqzs.3cerp.com'):
                        raise AppError('仅接受 ERP 采集脚本', 403)
                    result = service.collector(path.rsplit('/', 1)[1], self.body())
                    return self.send(200, result, headers={'Access-Control-Allow-Origin': 'https://cqzs.3cerp.com', 'Vary': 'Origin'} if origin else None)
                if path in ('/api/image', '/api/asset') and self.command == 'POST':
                    return self.image(path, cookie)
                if path.startswith('/uploads/') and self.command == 'GET':
                    return self.send(200, service.cloud.download_asset(path), 'image/png' if path.endswith('.png') else 'image/jpeg')
                if self.command != 'GET':
                    raise AppError('不支持此操作', 405)
                return self.static(path)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return
            except Exception as error:
                status = error.status if isinstance(error, AppError) else 404 if isinstance(error, FileNotFoundError) else 500
                message = str(error) if isinstance(error, AppError) else '文件不存在' if status == 404 else '本机处理失败，原数据已保留；请重试'
                try:
                    self.send(status, dict(error=message))
                except OSError:
                    pass  # Client disconnected while background operation completed.

        def workspace(self, action, cookie):
            cloud = service.cloud
            if action == 'config' and self.command == 'GET':
                return self.send(200, dict(config=service.config, csrf=cloud.csrf))
            import hmac
            if not hmac.compare_digest(self.headers.get('X-DIY-Sync', ''), cloud.csrf):
                raise AppError('请从工作台打开同步功能', 403)
            if action == 'status' and self.command == 'GET':
                with service.lock:
                    result = cloud.status() if cloud.authenticated(cookie) else dict(configured=bool(service.config), signedIn=False, enabled=False)
                return self.send(200, result)
            data = self.body() if self.command == 'POST' else {}
            if action == 'session' and self.command == 'POST':
                result, value = cloud.login(data)
                return self.send(200, result, headers={'Set-Cookie': f'diy_session={value}; HttpOnly; SameSite=Strict; Path=/'})
            if action == 'logout' and self.command == 'POST':
                result = cloud.logout(cookie)
                return self.send(200, result, headers={'Set-Cookie': 'diy_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
            with service.lock:
                cloud.require_login(cookie)
            if action == 'enable' and self.command == 'POST':
                return self.send(200, cloud.enable(data, cookie))
            if action in ('commits', 'compare') and self.command == 'POST':
                return self.send(200, cloud.inspect_changes(action, data, cookie))
            with service.lock:
                if action == 'local-history' and self.command == 'POST':
                    result = service.store.local_history(data.get('before'))
                elif action == 'preview' and self.command == 'GET':
                    result = service.domain('migrationSummary', service.state)
                    result.pop('records')
                elif action == 'conflicts' and self.command == 'GET':
                    result = dict(records=[r for r in service.store.records() if r['conflict']])
                elif action == 'run' and self.command == 'POST':
                    if not cloud.enabled():
                        raise AppError('请先启用同步')
                    cloud.schedule(manual=True)
                    result = cloud.status()
                elif action == 'pause' and self.command == 'POST':
                    cloud.paused = bool(data.get('paused'))
                    if not cloud.paused:
                        cloud.schedule()
                    result = cloud.status()
                elif action == 'resolve' and self.command == 'POST':
                    service.store.resolve(data.get('type'), data.get('id'), data.get('choice'), actor=cloud.audit_actor())
                    cloud.materialize()
                    result = cloud.status()
                elif action == 'backup' and self.command == 'POST':
                    result = service.store.backup()
                else:
                    raise AppError('未知同步操作', 404)
            return self.send(200, result)

        def sql(self, action, cookie):
            with service.lock:
                owner, epoch = service.cloud.owner(cookie), service.cloud.epoch
            if action == 'credentials' and self.command == 'GET':
                result = service.credentials.read(owner)
                with service.lock:
                    if service.cloud.owner(cookie) != owner or epoch != service.cloud.epoch:
                        raise AppError('登录身份已变化，请重新打开连接设置')
            elif action == 'status' and self.command == 'GET':
                with service.lock:
                    result = dict(lastSuccess=(service.state.get('erpSync') or {}).get('sqlSync') or service.state.get('sqlSync'))
            elif self.command == 'POST':
                data = self.body()
                if action == 'forget':
                    result = service.credentials.clear(owner)
                elif action == 'preview':
                    result = service.sql_preview(data, cookie)
                elif action == 'apply':
                    result = service.sql_apply(data.get('id'), cookie)
                else:
                    raise AppError('未知数据库操作', 404)
            else:
                raise AppError('不支持此操作', 405)
            return self.send(200, result)

        def image(self, path, cookie):
            data = self.body()
            try:
                raw = base64.b64decode(data.get('png' if path == '/api/image' else 'base64', ''), validate=True)
            except ValueError:
                raise AppError('图片格式无效') from None
            png = raw.startswith(b'\x89PNG\r\n\x1a\n')
            jpg = raw.startswith(b'\xff\xd8')
            if not png and not jpg:
                raise AppError('请选择 PNG 或 JPG 图片')
            with service.lock:
                service.cloud.require_login(cookie)
                if path == '/api/asset':
                    name = digest(raw) + ('.png' if png else '.jpg')
                    atomic(service.local / 'assets' / name, raw)
                    return self.send(200, dict(url='/uploads/' + name))
                config = next((c for c in service.state['configs'] if c['id'] == data.get('id')), None)
                if not config or data.get('revision') != service.state['revision']:
                    raise AppError('配置版本已变化，请重新生成图片', 409)
                if not png or len(raw) < 24 or data.get('layout') not in ('long', 'square') or data.get('theme') not in ('light', 'dark'):
                    raise AppError('图片或版式无效')
                safe = lambda value: re.sub(r'[^a-zA-Z0-9_-]', '_', str(value))
                name = f"{safe(config['shopId'])}_{safe(config['id'])}_r{data['revision']}_{data['layout']}_{data['theme']}.png"
                atomic(service.local / 'images' / name, raw)
                width, height = struct.unpack('>II', raw[16:24])
                return self.send(200, dict(url='/saved/' + name, revision=data['revision'], width=width, height=height))

        def static(self, path):
            relative = path.lstrip('/') or 'index.html'
            base = service.root / 'web'
            if relative.startswith('saved/'):
                base, relative = service.local / 'images', relative[6:]
            if '\\' in relative or any(p.startswith('.') for p in relative.split('/')):
                raise AppError('路径不可访问', 403)
            file = (base / relative).resolve()
            if not file.is_relative_to(base.resolve()) or file.suffix not in ('.js', '.css', '.html', '.json', '.png', '.jpg', '.jpeg', '.ico', '.woff', '.woff2'):
                raise AppError('文件不存在', 404)
            raw = file.read_bytes()
            if relative == 'workbench-erp.user.js':
                raw = raw.replace(b'http://127.0.0.1:4178/api/erp-bridge/', f'http://127.0.0.1:{self.server.server_port}/api/erp-bridge/'.encode())
            mime = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8'}.get(file.suffix) or mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
            # Static JSON is already serialized.
            return self.send(200, json.loads(raw) if file.suffix == '.json' else raw, mime)

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = False
    return server


def start_server(service, port=0):
    server = create_server(service, port)
    thread = threading.Thread(target=server.serve_forever, name='local-http', daemon=True)
    thread.start()
    return server
