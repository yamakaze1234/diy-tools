# Python 桌面版

现有 HTML/CSS 和配置图渲染继续使用。桌面由 Python + pywebview / Windows Edge WebView2 承载，SQL、CloudBase 网络访问、SQLite 同步队列、JSON 文件保存、历史版本、凭据加密和后台调度全部由 Python 实现；运行时不启动 Node 或 Electron。

少量经过现有测试验证的业务纯函数（配置标准化、投影、合并、差异计算）通过 Python 内嵌 QuickJS 复用，避免迁移改变报价、字段含义或布局。这些函数不能读写文件、访问网络或执行系统命令。构建时使用 Node/esbuild 打包共享规则；使用者不需要安装 Node 或 Python。

## 开发

1. `py -3 -m venv python-desktop/.venv`
2. `python-desktop/.venv/Scripts/python.exe -m pip install -r python-desktop/requirements.txt`
3. `node python-desktop/build-web.mjs`
4. `python-desktop/.venv/Scripts/python.exe -X utf8 python-desktop/main.py`

默认保存到 **EXE 所在文件夹的 `data`**，登录缓存与运行信息保存在 `data/runtime`，不再默认写入 AppData。源码运行时为 `python-desktop/data`。当该工具文件夹尚无 data 时，自动从旧 `%APPDATA%\DIYWorkbench\data` 复制迁入，旧目录保留；已有 data 时绝不覆盖或混入旧数据。首次迁移自动备份 state.json、workspace.sqlite、versions.sqlite；旧版未同步草稿、不可变提交队列和历史版本沿用。旧版必须先正常退出。UI 登录存储使用独立 WebView2 配置目录，因此首次需要重新登录；SQL 凭据可兼容旧版 Windows 加密格式。

ERP 成本及可销数仍只在本机保存，SQL 读取后预览确认。人工核算价和配置继续云同步。用户登录令牌只在 Python 进程内存中使用，不写入诊断日志。

0.3.2 起，编辑优先保存到本机 SQLite/JSON；普通编辑、图片操作和已有工作区登录不触发云端上传或拉取。自动云同步间隔为两小时，“多人同步 → 立即同步”马上执行一次，并从本次开始重新计算两小时。暂停自动同步仍允许手动同步。首次发布或空白工作区接收数据立即执行。下次自动同步时间保存在本机，失败时保留队列，等待下一周期或手动重试。

“多人同步 → 修改与提交记录”提供三种只读视图：本机修改记录、本机 / 云端差异、云端提交记录。本机修改按保存操作生成 UUID，记录已验证的登录成员、本机 UTC 时间和同步业务字段的前后内容，持久保存在 `workspace.sqlite` 的 `local_changes` 表中；从此功能启用后开始记录，不补造旧修改。ERP 成本和库存等仅本机字段不在此同步变更记录范围内。

云端提交复用已有变更日志中的 `mutationId`、`updatedAt`（服务器时间）、`updatedBy`（成员 ID）、记录版本与内容，每条业务记录为一次提交；一轮同步可能有多条。没有产生数据变化的成功请求不产生新的变更日志。其他成员的显示名尚未由接口提供，因此直接展示成员 ID。两端时间只用于追溯，不用于覆盖判断。

本机 / 云端差异会读取固定云端序号范围，对照上次同步基准、本机草稿与云端最新内容，并显示冲突字段。查看不会执行提交、修改本机业务数据或推进同步游标；本机在读取期间发生变化会要求重新比较。云端读取失败仍可返回查看本机记录。同步本身在后台线程运行，但一轮内严格等待上传回执再拉取，提交未确认则停止并保留原提交 ID。

图片拖动按动画帧合并输入，复用文字和背景画布，只重新绘制图片；松手前也能更新位置。普通本地保存不等待 PNG，保存完成并空闲三秒后生成图片；新编辑会推迟任务，过时结果不会标记为最新图片。“保存配置”仍可立即生成本地图片，PNG/ZIP 正式导出保持原分辨率。图库选图先返回编辑界面，切换图库选中项不重建整个列表。

所有远程调用具有超时。Python HTTP 请求线程执行 SQL；同步单独运行于后台线程；仅本机提交与 SQLite 事务串行。SQL/云网络等待期间不持有状态锁。

## 构建与验证

`python-desktop/.venv/Scripts/python.exe -X utf8 -m unittest discover -s python-desktop/tests -v`

`python-desktop/.venv/Scripts/python.exe -X utf8 python-desktop/build.py`

`python-desktop/.venv/Scripts/python.exe -X utf8 python-desktop/package.py`

构建位置记录在 `verification/latest-build.json`。分发脚本仅收录 EXE、`_internal`、使用说明和 WebView2 安装程序，自动排除程序旁的 `data`，即使本机已使用过该程序也不会把业务数据打入分发包。

版本：0.3.4。Windows 10/11 x64；使用 Windows Edge WebView2 运行时。分发包不包含当前业务数据、登录令牌或 SQL 账号密码。
