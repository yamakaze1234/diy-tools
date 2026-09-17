"""Send WM_CLOSE only to the window owned by the launched test process."""
import ctypes
import sys
import time
from ctypes import wintypes
pid = int(sys.argv[1])
found = []
callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

@callback
def visit(hwnd, _):
    owner = wintypes.DWORD()
    ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    if owner.value == pid and ctypes.windll.user32.IsWindowVisible(hwnd):
        title = ctypes.create_unicode_buffer(256)
        ctypes.windll.user32.GetWindowTextW(hwnd, title, 256)
        if title.value in ('DIY 配置工作台', 'DIY配置工作台'):
            found.append(hwnd)
    return True

for _ in range(25):
    found.clear()
    ctypes.windll.user32.EnumWindows(visit, 0)
    if len(found) == 1:
        break
    time.sleep(0.2)
if len(found) != 1:
    raise RuntimeError(f'Expected exactly one visible test window, got {len(found)} for PID {pid}')
ctypes.windll.user32.PostMessageW(found[0], 0x10, 0, 0)
