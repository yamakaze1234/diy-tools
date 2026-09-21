"""Notify Explorer only after WebView2 has completed writing a download."""
import ctypes
from pathlib import Path


def notify_download(path):
    path = Path(path).resolve()
    if not path.is_file():
        return False
    shell = ctypes.windll.shell32
    shell.SHChangeNotify.argtypes = [ctypes.c_long, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    shell.SHChangeNotify.restype = None
    # SHCNF_PATHW | SHCNF_FLUSHNOWAIT; update existing files as well as new files.
    shell.SHChangeNotify(0x00002000, 0x2005, ctypes.cast(ctypes.c_wchar_p(str(path)), ctypes.c_void_p), None)
    shell.SHChangeNotify(0x00001000, 0x2005, ctypes.cast(ctypes.c_wchar_p(str(path.parent)), ctypes.c_void_p), None)
    return True


def watch_download(operation, notify=notify_download):
    def changed(sender, args):
        state = str(operation.State)
        if state not in ('Completed', 'Interrupted'):
            return
        operation.StateChanged -= changed
        if state == 'Completed':
            notify(str(operation.ResultFilePath))
    operation.StateChanged += changed
    # Small files can complete before subscription finishes.
    changed(None, None)


def install_download_notifications():
    from webview.platforms.edgechromium import EdgeChrome
    original = EdgeChrome.on_download_starting
    if getattr(original, '_workbench_notify', False):
        return

    def starting(self, sender, args):
        original(self, sender, args)
        if not args.Cancel:
            watch_download(args.DownloadOperation)
    starting._workbench_notify = True
    EdgeChrome.on_download_starting = starting
