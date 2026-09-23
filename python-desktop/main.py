"""Python desktop entry point, using Edge WebView2 to show the existing UI."""
import argparse
import ctypes
import json
import os
import sys
import threading
from pathlib import Path
from common import atomic, dumps, digest
from service import Service
from server import start_server
from storage_paths import storage_paths, prepare_storage

VERSION = '1.0.18'


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--headless', action='store_true', help='Run local backend only for verification')
    parser.add_argument('--port', type=int, default=None)
    parser.add_argument('--source-preview', action='store_true', help='Label the source review window and start with automatic cloud sync paused')
    args = parser.parse_args()
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).parent)).resolve()
    paths = storage_paths()
    profile, local = paths.profile, paths.data
    # Scoped to the data directory so isolated test profiles do not block users.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.restype = ctypes.c_void_p
    mutex = kernel.CreateMutexW(None, False, 'Local\\DIYWorkbenchPython-' + digest(str(local).lower())[:24])
    if not mutex or ctypes.get_last_error() == 183:
        raise RuntimeError('此数据目录的 Python 工作台已经运行，请使用已打开的窗口。')
    prepare_storage(paths)
    runtime_file = profile / 'desktop-runtime.json'
    remembered = {}
    if runtime_file.exists():
        remembered = json.loads(runtime_file.read_text(encoding='utf-8'))
    port = args.port if args.port is not None else int(os.environ.get('DIY_WORKBENCH_PORT') or remembered.get('port') or 4179)
    if port:
        import requests
        try:
            existing = requests.get(f'http://127.0.0.1:{port}/api/workspace-sync/config', timeout=1)
            if existing.ok and 'csrf' in existing.json():
                raise RuntimeError('检测到旧版或另一工作台仍在运行，请先正常退出，再打开 Python 版。')
        except (requests.RequestException, ValueError):
            pass
    service = Service(root, local)
    if args.source_preview:
        service.cloud.paused = True
    try:
        server = start_server(service, port)
    except OSError:
        server = start_server(service, 0)
    port = server.server_port
    atomic(runtime_file, dumps(dict(port=port, backend='python', version=VERSION, pid=os.getpid())))
    url = f'http://127.0.0.1:{port}'
    try:
        if args.headless:
            print('WORKBENCH_READY ' + url, flush=True)
            threading.Event().wait()
            return
        import webview
        from download_notify import install_download_notifications
        from webview_autofill import disable_saved_form_info
        install_download_notifications()
        webview.settings['ALLOW_DOWNLOADS'] = True
        webview.settings['ALLOW_FILE_URLS'] = False
        webview.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = True
        webview.settings['OPEN_DEVTOOLS_IN_DEBUG'] = False
        if os.environ.get('DIY_WORKBENCH_DEBUG_PORT'):
            webview.settings['REMOTE_DEBUGGING_PORT'] = int(os.environ['DIY_WORKBENCH_DEBUG_PORT'])
        title = 'DIY 配置工作台 · 源码预览' if args.source_preview else 'DIY 配置工作台'
        window = webview.create_window(title, url, width=1600, height=1000, min_size=(1100, 720))
        closing = {'busy': False, 'allow': False}

        class WindowAPI:
            def close_ready(self):
                closing['allow'] = True
                window.destroy()

            def close_failed(self):
                closing['busy'] = False

        window.expose(WindowAPI().close_ready, WindowAPI().close_failed)

        def close_requested():
            if closing['allow']:
                return True
            if closing['busy']:
                return False
            closing['busy'] = True
            def close_timeout():
                if not closing['busy'] or closing['allow']:
                    return
                closing['busy'] = False
                if ctypes.windll.user32.MessageBoxW(None, '页面长时间未响应。已保存的数据会保留，尚未保存的输入可能丢失。是否仍然退出？', '工作台未响应', 0x24) == 6:
                    closing['allow'] = True
                    window.destroy()
            watchdog = threading.Timer(55, close_timeout)
            watchdog.daemon = True
            watchdog.start()

            def save_before_close():
                try:
                    window.evaluate_js("Promise.resolve(window.workbenchBeforeQuit ? window.workbenchBeforeQuit() : null).then(()=>window.pywebview.api.close_ready()).catch(e=>{alert('配置尚未保存：'+e.message);window.pywebview.api.close_failed();});")
                except Exception:
                    closing['busy'] = False
                    ctypes.windll.user32.MessageBoxW(None, '无法确认保存结果，请在界面保存后再关闭工作台。', '配置尚未保存', 0x10)
            threading.Thread(target=save_before_close, name='save-before-close', daemon=True).start()
            return False

        window.events.closing += close_requested
        webview.start(func=lambda: disable_saved_form_info(window, runtime_file), gui='edgechromium', private_mode=False, storage_path=str(profile / 'python-webview'), icon=str(root / 'web' / 'assets' / 'workbench-icon-v1.ico'))
    finally:
        server.shutdown()
        server.server_close()
        service.close()
        kernel.CloseHandle(ctypes.c_void_p(mutex))


if __name__ == '__main__':
    try:
        run()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        if '--headless' in sys.argv:
            raise
        ctypes.windll.user32.MessageBoxW(None, str(error), '工作台启动失败', 0x10)
