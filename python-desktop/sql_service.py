"""Read-only SQL Server access and exact goods_id normalization."""
import math
import re
import socket
import threading
from decimal import Decimal
from common import AppError

QUERIES = [
    'SELECT TOP (100001) CONVERT(varchar(20), [goods_id]) AS [goods_id], [库房], [商品编码], [商品名称], [分库数], [分库可销数], [分库待入], [库存成本] FROM [库存].[分库库存]',
    'SELECT TOP (100001) CONVERT(varchar(20), [goods_id]) AS [goods_id], [商品编码], [商品名称], [总数量], [可销数], [待入] FROM [库存].[库存查询]',
]


def settings(value):
    if not isinstance(value, dict):
        raise AppError('请填写服务器、数据库和账号')
    result = {}
    for key in ('server', 'database', 'user'):
        item = value.get(key)
        if not isinstance(item, str) or not item.strip() or len(item) > 200:
            raise AppError('请填写服务器、数据库和账号')
        result[key] = item.strip()
    try:
        result['port'] = int(value.get('port') or 1433)
    except (ValueError, TypeError):
        raise AppError('数据库端口无效') from None
    if not 1 <= result['port'] <= 65535:
        raise AppError('数据库端口无效')
    result['encrypt'] = value.get('encrypt') is not False
    result['trustServerCertificate'] = value.get('trustServerCertificate') is True
    return result


def normalize(bundle):
    warehouses, catalog = bundle.get('warehouses'), bundle.get('catalog')
    if not isinstance(warehouses, list) or not isinstance(catalog, list) or not catalog or max(len(warehouses), len(catalog)) > 100000:
        raise AppError('数据库目录为空、不完整或超过 100000 行，已保留原数据')
    legacy = any(r.get('库房') == bytes.fromhex('b9abcbbeb4f3bfe2').decode('latin1') for r in warehouses)
    by_id, codes, warehouse_keys, catalog_ids = {}, {}, set(), set()

    def decoded(value):
        if isinstance(value, bytes):
            try:
                return value.decode('gb18030' if legacy else 'utf-8')
            except UnicodeError:
                raise AppError('数据库文本编码不一致，已保留原数据') from None
        if not isinstance(value, str):
            raise AppError('数据库文本字段无效')
        if legacy and all(ord(c) < 256 for c in value):
            try:
                value = value.encode('latin1').decode('gb18030')
            except UnicodeError:
                raise AppError('数据库文本编码不一致，已保留原数据') from None
        return value.strip()

    def numeric(value):
        if value is None:
            return None
        try:
            if isinstance(value, bool) or (isinstance(value, str) and not value.strip()):
                raise ValueError()
            number = float(value)
            if not math.isfinite(number):
                raise ValueError()
            return number
        except (ValueError, TypeError):
            raise AppError('数据库库存数值无效，已保留原数据') from None

    def identity(row):
        key = row.get('goods_id')
        if not isinstance(key, (str, int)) or isinstance(key, bool) or not re.fullmatch(r'[1-9]\d{0,19}', str(key)):
            raise AppError('数据库 goods_id 缺失或不精确')
        key, name, sku = str(key), decoded(row.get('商品名称')), decoded(row.get('商品编码'))
        if not name or not sku or sku == '0':
            raise AppError('数据库商品身份不完整')
        if (sku in codes and codes[sku] != key) or (key in by_id and by_id[key]['sku'] != sku):
            raise AppError('数据库商品编号与编码不一致')
        codes[sku] = key
        return dict(goodsId=key, name=name, sku=sku)

    for raw in warehouses:
        if '分库数' not in raw or '分库可销数' not in raw:
            raise AppError('数据库缺少公司大库库存字段')
        ident = identity(raw)
        key, warehouse = ident['goodsId'], decoded(raw.get('库房'))
        if not warehouse or len(warehouse) > 100 or (key, warehouse) in warehouse_keys:
            raise AppError('库房身份无效或同一商品和库房出现重复记录')
        warehouse_keys.add((key, warehouse))
        numeric(raw.get('分库数'))
        numeric(raw.get('分库待入'))
        able = numeric(raw.get('分库可销数'))
        row = by_id.get(key, {**ident, 'stockAvailable': None, 'erp': None})
        if warehouse == '公司大库':
            if '库存成本' not in raw:
                raise AppError('数据库缺少库存成本字段')
            cost = numeric(raw['库存成本'])
            if cost is not None and cost < 0:
                raise AppError('SQL 库存成本必须是非负单件成本')
            row.update(stockAvailable=able, erp=cost)
        by_id[key] = row
    for raw in catalog:
        ident = identity(raw)
        key = ident['goodsId']
        if key in catalog_ids:
            raise AppError('完整目录商品编号重复')
        catalog_ids.add(key)
        by_id[key] = {**by_id.get(key, dict(stockAvailable=None, erp=None)), **ident}
    return list(by_id.values())


_tls_settings = threading.local()
_install_lock = threading.Lock()
_installed = False


def _install_tls_adapter():
    # pytds has a CA-file option but no trust-server-certificate switch. This
    # per-thread adapter changes verification only for the explicitly checked box.
    global _installed
    with _install_lock:
        if _installed:
            return
        from pytds import tls
        from OpenSSL import SSL
        original = tls.create_context

        def context(cafile):
            ctx = original(cafile)
            if getattr(_tls_settings, 'trust', False):
                ctx.set_verify(SSL.VERIFY_NONE, lambda *_: True)
            return ctx
        tls.create_context = context
        _installed = True


def read_bundle(config, password, connector=None):
    config = settings(config)
    if not isinstance(password, str) or not password or len(password) > 1024:
        raise AppError('请输入数据库密码')
    import certifi
    import pytds
    _install_tls_adapter()
    connection = None
    stage = '连接数据库'
    try:
        _tls_settings.trust = config['trustServerCertificate']
        connection = (connector or pytds.connect)(server=config['server'], port=config['port'], database=config['database'], user=config['user'], password=password,
            login_timeout=10, timeout=30, as_dict=True, autocommit=True, readonly=True, appname='DIYWorkbenchPythonReadonly',
            cafile=certifi.where() if config['encrypt'] else None, validate_host=not config['trustServerCertificate'], enc_login_only=False, disable_connect_retry=True, pooling=False)
        stage = '读取库存'
        cursor, results = connection.cursor(), []
        for query in QUERIES:
            cursor.execute(query)
            rows = []
            while True:
                chunk = cursor.fetchmany(1000)
                if not chunk:
                    break
                rows.extend(chunk)
                if len(rows) > 100000:
                    raise AppError('查询超过 100000 行，已拒收截断数据')
            results.append(rows)
        return dict(warehouses=results[0], catalog=results[1])
    except AppError:
        raise
    except Exception as error:
        # Inspect but never display driver messages: they may contain credentials.
        message = str(error).lower()
        number = getattr(error, 'number', None)
        detail, code = '请核对公司网络、账号、实际数据库名和连接设置', 'SQL_CONNECTION'
        if isinstance(error, (TimeoutError, socket.timeout)) or 'timed out' in message:
            detail, code = '连接或查询超时，请检查网络及数据库负载', 'SQL_TIMEOUT'
        elif 'certificate' in message:
            detail, code = '证书校验失败；公司确认使用自签证书时可勾选信任服务器证书', 'SQL_CERTIFICATE'
        elif number in (4060, 911):
            detail, code = '数据库不存在或无权打开，请填写实际数据库名', 'SQL_DATABASE'
        elif number == 18456 or 'login failed' in message:
            detail, code = '登录失败，请核对用户名、密码和数据库访问权限', 'SQL_LOGIN'
        elif number in (207, 208, 229, 916):
            detail, code = '缺少库存视图、字段或只读查询权限', 'SQL_SCHEMA'
        raise AppError(f'{stage}失败 [{code}]：{detail}。本机原数据未改动。') from None
    finally:
        _tls_settings.trust = False
        if connection:
            try:
                connection.close()
            except Exception:
                pass  # A broken network must not hide the original read error.
