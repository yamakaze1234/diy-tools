"""Export rendered PNGs to a newly created folder chosen in the desktop UI."""
import base64
import binascii
import json
import re
from datetime import datetime
from pathlib import Path
from threading import Lock

def valid_export_name(name):
    if not isinstance(name, str):
        return False
    if re.fullmatch(r'(?:[1-9][0-9]*\.png|导出清单\.json)', name):
        return True
    segments = name.split('/')
    if len(segments) != 3 or not segments[-1].endswith('.png'):
        return False
    return all(segment not in ('', '.', '..') and len(segment) <= 180
               and segment == segment.rstrip(' .')
               and not re.search(r'[<>:"\\|?*\x00-\x1f]', segment)
               and not re.fullmatch(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', segment, re.I)
               for segment in segments)


class FolderExporter:
    def __init__(self, choose, authorize):
        self.choose = choose
        self.authorize = authorize
        self.lock = Lock()

    def export_image_folder(self, payload):
        with self.lock:
            self.authorize()
            files = payload.get('files') if isinstance(payload, dict) else None
            if not isinstance(files, list) or not 2 <= len(files) <= 1001:
                raise ValueError('图片导出清单无效')
            decoded, names, total = [], set(), 0
            for item in files:
                name = item.get('name', '') if isinstance(item, dict) else ''
                encoded = item.get('base64', '') if isinstance(item, dict) else ''
                if not valid_export_name(name) or name.casefold() in names:
                    raise ValueError('图片导出文件名无效或重复')
                if not isinstance(encoded, str) or len(encoded) > 90_000_000:
                    raise ValueError('单张图片过大，请降低导出宽度')
                try:
                    raw = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error) as error:
                    raise ValueError('图片导出内容无效') from error
                total += len(raw)
                if total > 512 * 1024 * 1024:
                    raise ValueError('本次图片超过 512MB，请分批导出')
                if name.endswith('.png'):
                    if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
                        raise ValueError('图片不是 PNG 格式')
                else:
                    json.loads(raw)
                names.add(name.casefold())
                decoded.append((name, raw))
            if '导出清单.json' not in names:
                raise ValueError('缺少图片导出清单')
            selected = self.choose()
            if not selected:
                return {'cancelled': True}
            self.authorize()
            parent = Path(selected[0]).resolve(strict=True)
            if not parent.is_dir():
                raise ValueError('请选择保存文件夹')
            label = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(payload.get('name') or '配置图片')).strip(' .')[:60] or '配置图片'
            base = label + '_' + datetime.now().strftime('%Y%m%d-%H%M%S')
            index = 0
            while True:
                target = parent / (base + (f'_{index}' if index else ''))
                try:
                    target.mkdir()
                    break
                except FileExistsError:
                    index += 1
            try:
                for name, raw in decoded:
                    output_path = (target / name).resolve()
                    output_path.relative_to(target.resolve())
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    with output_path.open('xb') as output:
                        output.write(raw)
            except OSError as error:
                raise RuntimeError(f'导出未完成，已写入的图片保留在：{target}；{error}') from error
            return {'cancelled': False, 'directory': str(target), 'count': len(decoded) - 1}
