"""Ephemeral, member-session-bound jobs for the logged-in ERP browser bridge."""
import copy
import re
import time
import uuid
from common import AppError


class ProductJobs:
    def __init__(self, validate):
        self.validate = validate
        self.owner = None
        self.job = None
        self.connection = None

    def session(self, owner):
        if not owner:
            raise AppError('请先登录工作台成员账号', 401)
        if self.owner != owner:
            self.owner, self.job, self.connection = owner, None, None

    def status(self):
        job = self.job
        if job and job['status'] in ('waiting', 'running') and time.monotonic() > job['deadline']:
            job.update(status='failed', error='ERP 商品查询超时，请检查 ERP 登录及最新版连接脚本后重试')
        return dict(job={k: copy.deepcopy(v) for k, v in job.items() if k not in ('token', 'clientId', 'deadline')} if job else None,
                    connection=copy.deepcopy(self.connection) if self.connection and time.monotonic()-self.connection['seen'] < 25 else None)

    @staticmethod
    def identity(data):
        if not isinstance(data.get('clientId'), str) or not 1 <= len(data['clientId']) <= 100 or not isinstance(data.get('account'), str) or not 1 <= len(data['account'].strip()) <= 100:
            raise AppError('ERP 账号或连接标识无效')

    def start(self, data):
        self.status()
        if self.job and self.job['status'] in ('waiting', 'running'):
            raise AppError('已有商品查询正在进行，请等待完成或取消', 409)
        for key in ('erpShopId', 'spu'):
            if not isinstance(data.get(key), str) or not re.fullmatch(r'\d{1,30}', data[key]) or not int(data[key]):
                raise AppError('请填写准确的 ERP 店铺 ID 和 SPU 编码')
        account = data.get('account')
        if not isinstance(account, str) or not 1 <= len(account.strip()) <= 100:
            raise AppError('请填写 ERP 顶栏显示的账号姓名')
        self.job = dict(id=str(uuid.uuid4()), status='waiting', account=account.strip(), erpShopId=data['erpShopId'], spu=data['spu'], deadline=time.monotonic()+300, progress='等待 ERP 页面连接')
        return self.status()

    def poll(self, data):
        self.identity(data)
        self.status()
        self.connection = dict(account=data['account'], seen=time.monotonic())
        job = self.job
        if not job or job['status'] != 'waiting' or job['account'] != data['account']:
            return dict(job=None)
        job.update(status='running', token=str(uuid.uuid4()), clientId=data['clientId'], progress='正在刷新 ERP 网店商品')
        return dict(job={k: job[k] for k in ('id', 'token', 'account', 'erpShopId', 'spu')})

    def verify(self, data):
        self.identity(data)
        self.status()
        job = self.job
        if not job or job['status'] != 'running' or any(data.get(k) != job[v] for k, v in [('jobId', 'id'), ('token', 'token'), ('clientId', 'clientId'), ('account', 'account')]):
            raise AppError('商品查询任务已过期或不属于此 ERP 页面', 409)
        return job

    def collect(self, action, data):
        if action == 'poll':
            return self.poll(data)
        job = self.verify(data)
        if action == 'progress':
            job['progress'] = str(data.get('progress', '查询中'))[:100]
        elif action == 'result':
            result = self.validate(data.get('result'))
            if result['SKU'] and (result.get('店铺ID') != job['erpShopId'] or result.get('SPU编码') != job['spu']):
                raise AppError('ERP 返回的店铺或 SPU 与查询目标不一致')
            job.update(status='complete', result=result, progress='查询完成，请在工作台预览并确认')
        elif action == 'error':
            job.update(status='failed', error=str(data.get('error', 'ERP 查询失败'))[:200])
        else:
            raise AppError('未知的商品查询操作', 404)
        return dict(ok=True)

    def cancel(self):
        if self.job and self.job['status'] in ('waiting', 'running'):
            self.job.update(status='cancelled', progress='本机已取消接收；已发出的 ERP 刷新请求可能仍会完成')
        return self.status()
