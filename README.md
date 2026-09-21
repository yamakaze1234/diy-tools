# DIY 配置工作台（diy-tools）

用于 DIY 整机配置维护、配件成本管理、配置图编辑与导出、ERP 库存读取和多人云同步的 Windows 桌面工具。当前源码为 Python 桌面版 **0.3.25**；仓库保留共用前端、Node 开发服务和轻量网页版。Electron 桌面构建入口已退役。

## 下载 Windows 程序

[下载最新 Release](https://github.com/yamakaze1234/diy-tools/releases/latest)。发布版本以 Release 页面为准，可能与当前源码版本不同。

下载 Release 中的 Windows ZIP，完整解压后运行 EXE，无需安装 Python/Node。公开包使用云配置占位模板，需按[部署说明](docs/部署与开发.md)配置自己的云环境和成员账号；包内不含现有团队数据。

## 文档导航

- [完整使用手册](docs/使用手册.md)：安装、登录、配置编辑、ERP、图库、同步与历史版本。
- [部署与开发](docs/部署与开发.md)：源码启动、云端配置、成员开通、测试与打包。
- [系统架构](docs/架构说明.md)：组件关系、源码职责、同步时序与数据边界。
- [维护与排错](docs/维护与排错.md)：备份、升级、迁移、恢复及常见问题。
- [交互架构图](docs/diagrams/architecture.html)：下载后在浏览器打开。

## 整体架构

![DIY 配置工作台系统架构](docs/diagrams/architecture.png)

[打开可交互架构图](docs/diagrams/architecture.html) · [下载 HTML 后在浏览器中打开](https://raw.githubusercontent.com/yamakaze1234/diy-tools/main/docs/diagrams/architecture.html)

支持主题切换、缩放、搜索和导出。GitHub 首页直接展示上方预览图；交互功能在下载的 HTML 中使用。

## 功能

- 多店配置、模板、加购项目、批量配色与配置顺序管理。
- 机箱图库、图片图层、配置海报与 PNG/ZIP 导出。
- ERP/SQL 成本与可销数读取、差异预览和确认后应用。
- 本机 SQLite/JSON 保存、历史版本、成员登录与 CloudBase 同步。
- 本机修改记录、云端提交记录和冲突比较；普通编辑先保存在本机。

## 目录

| 路径 | 内容 |
| --- | --- |
| `python-desktop/` | Python + pywebview 桌面端、构建脚本和合成数据测试 |
| `prototype/` | HTML/CSS/JavaScript 界面、共享业务模块、Node 开发服务 |
| `shared/` | 同步协议和迁移逻辑 |
| `web-lite/` | 轻量网页版源码、构建脚本与测试 |
| `cloud/functions/workbenchApi/` | CloudBase 云函数 |
| `cloudbase/migrations/` | PostgreSQL 迁移 SQL |

## 开发启动

Windows 10/11 x64、PowerShell 7、Node.js 24、uv 和 Python 3.13.6。桌面窗口需要 Microsoft Edge WebView2。

在仓库根目录执行：

```powershell
npm ci --prefix prototype
if (!(Test-Path prototype/.env.local)) { Copy-Item prototype/.env.example prototype/.env.local }
# 编辑 prototype/.env.local，填写自己的 CloudBase 客户端配置。
npm run build:sync --prefix prototype
uv sync --project python-desktop --locked
node python-desktop/build-web.mjs
uv run --project python-desktop --locked python -X utf8 python-desktop/main.py
```

程序需要登录成员账号。示例配置只能用于构建，不提供可用账号或云服务。使用自己的 CloudBase PostgreSQL 环境，按文件名顺序审阅并执行迁移，部署 `workbenchApi` 并设置云函数环境变量 `WORKBENCH_ENV_ID`；还需要配置认证和工作区成员。仓库不提供自动开通云服务的脚本。

如需运行浏览器原型，完成 Node 构建和云配置后，按[仓库说明](仓库说明.md)从示例初始化缺失的 seed/catalog 文件，再执行 `npm start --prefix prototype`。

## 测试与打包

```powershell
npm test --prefix prototype
uv run --project python-desktop --locked python -X utf8 -m unittest discover -s python-desktop/tests -v
uv run --project python-desktop --locked python -X utf8 python-desktop/build.py
```

先完成上述依赖安装和 Web 构建，再运行 Python 测试。默认 Node 测试包含全部 `tests/*.test.mjs`；配置、ERP 和实际配件测试使用仓库内的合成夹具，无需本机业务数据。浏览器、打包程序和在线验收脚本需要额外环境，未纳入默认测试。

构建结果位于 `release/`。`package.py` 还需要在构建目录中放置官方 `MicrosoftEdgeWebview2Setup.exe` 引导安装程序。Git 源码不包含二进制；打包程序和引导安装程序通过 Release ZIP 提供。详细桌面行为见 [Python 桌面说明](python-desktop/README.md)。

## 数据与配置

仓库提供 `prototype/seed.example.json` 和 `catalog.example.json` 空白模板；实际 `seed.json`、`catalog.json` 仅保留本地，不进入 Git。测试夹具使用合成数据。实际配置、成本、库存、客户或成员数据、本地登录缓存、SQL 凭据、生产云配置、验收截图和发布包均不上传。

源码运行的数据目录为 `python-desktop/data`；打包后为 EXE 同级的 `data`。首次启动有旧版本数据迁移逻辑；开发隔离时可设置 `DIY_WORKBENCH_DATA_DIR` 为专用目录。请勿将实际数据加入 Git。

本仓库尚未指定开源许可证。第三方依赖及品牌素材保留各自权利。
