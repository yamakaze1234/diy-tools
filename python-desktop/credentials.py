"""Windows DPAPI vault; compatible with the previous member-scoped envelope."""
import base64
import ctypes
import json
import threading
from ctypes import wintypes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from common import dumps, digest, atomic, AppError
from sql_service import settings

ENTROPY = b'DIY-Workbench:SQL-credentials:v1'


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def dpapi(data, encrypt=False, entropy=None):
    buf = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    out = Blob()
    entropy_buf = ctypes.create_string_buffer(entropy) if entropy else None
    extra = Blob(len(entropy), ctypes.cast(entropy_buf, ctypes.POINTER(ctypes.c_ubyte))) if entropy else None
    function = ctypes.windll.crypt32.CryptProtectData if encrypt else ctypes.windll.crypt32.CryptUnprotectData
    ok = function(ctypes.byref(source), None, ctypes.byref(extra) if extra else None, None, None, 1, ctypes.byref(out))
    if not ok:
        raise ValueError('Windows credential protection failed')
    try:
        return ctypes.string_at(out.data, out.size)
    finally:
        ctypes.windll.kernel32.LocalFree(out.data)


class Credentials:
    def __init__(self, local, legacy_profile=None):
        self.directory = local / 'sql-credentials'
        self.legacy_profile = legacy_profile or local.parent
        self.lock = threading.RLock()

    def identify(self, member):
        if not isinstance(member, str) or not member or len(member) > 512:
            raise AppError('需要登录后才能使用本机 SQL 连接资料')
        owner = digest(member)
        return owner, self.directory / (owner + '.json')

    def decrypt(self, encrypted, protection):
        if protection == 'windows-dpapi-current-user-v1':
            return dpapi(encrypted, entropy=ENTROPY)
        if protection == 'electron-safe-storage-v1':
            if encrypted.startswith(b'v10'):
                portable_key = self.directory / 'legacy-os-crypt.json'
                if portable_key.exists():
                    key_record = json.loads(portable_key.read_text(encoding='utf-8'))
                else:
                    key_record = json.loads((self.legacy_profile / 'Local State').read_text(encoding='utf-8'))['os_crypt']
                wrapped = base64.b64decode(key_record['encrypted_key'])
                if not wrapped.startswith(b'DPAPI'):
                    raise ValueError('Unknown Electron key format')
                key = dpapi(wrapped[5:])
                return AESGCM(key).decrypt(encrypted[3:15], encrypted[15:], None)
            return dpapi(encrypted)
        raise ValueError('Unknown encryption format')

    def read(self, member):
        with self.lock:
            owner, path = self.identify(member)
            try:
                if not path.exists():
                    return dict(saved=False, settings=None, password='')
                if path.stat().st_size > 65536:
                    raise ValueError()
                envelope = json.loads(path.read_text(encoding='utf-8'))
                if envelope['version'] != 1 or envelope['owner'] != owner or type(envelope['saved']) is not bool:
                    raise ValueError()
                if not envelope['saved']:
                    if 'ciphertext' in envelope:
                        raise ValueError()
                    return dict(saved=False, settings=None, password='')
                plain = self.decrypt(base64.b64decode(envelope['ciphertext'], validate=True), envelope['protection'])
                value = json.loads(plain)
                if value['owner'] != owner or value['version'] != 1 or not isinstance(value['password'], str) or not 0 < len(value['password']) <= 1024:
                    raise ValueError()
                return dict(saved=True, settings=settings(value['settings']), password=value['password'])
            except Exception:
                raise AppError('无法读取本机保存的 SQL 连接资料，请重新填写或清除本机保存') from None

    def save(self, member, config, password):
        with self.lock:
            owner, path = self.identify(member)
            try:
                if not isinstance(password, str) or not 0 < len(password) <= 1024:
                    raise ValueError()
                plain = dumps(dict(version=1, owner=owner, settings=settings(config), password=password)).encode('utf-8')
                ciphertext = dpapi(plain, encrypt=True, entropy=ENTROPY)
                if dpapi(ciphertext, entropy=ENTROPY) != plain:
                    raise ValueError()
                atomic(path, dumps(dict(version=1, owner=owner, saved=True, protection='windows-dpapi-current-user-v1', ciphertext=base64.b64encode(ciphertext).decode('ascii'))))
                return dict(saved=True)
            except Exception:
                raise AppError('无法安全保存 SQL 连接资料，原有保存资料保持不变') from None

    def clear(self, member):
        with self.lock:
            owner, path = self.identify(member)
            atomic(path, dumps(dict(version=1, owner=owner, saved=False)))
            return dict(saved=False)
