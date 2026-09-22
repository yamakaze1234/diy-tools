# uv 迁移说明

迁移日期：2026-09-20。迁移范围为 `python-desktop` 的开发环境与依赖管理；Node/npm、业务代码、云端配置和现有 EXE 保持原样。应用版本仍为 0.3.22。

## 备份

迁移前备份保存在项目目录之外的本机备份位置；该路径不属于公开仓库。

备份包含 Python 桌面项目源码、前端构建资源、测试、原 README、requirements.txt、构建记录、原 `.venv`、根目录启动脚本，以及包版本清单。源码和环境文件分别附带 SHA256 清单。未复制可再生的 `build`、临时 `.verification` 和源码 `__pycache__`；这是本次 Python 迁移的回退备份，不是整个仓库及业务数据的全量备份。

原 `.venv` 当时有进程正在使用，因此保留在原位置并由 uv 接管；另存的 `.venv` 是迁移前副本。备份中的 Windows 虚拟环境包含原路径，回退时必须恢复到原来的 `python-desktop/.venv`，不要从备份目录直接运行其入口程序。

## 开发命令

在 `配置工具` 根目录执行：

```powershell
uv sync --project python-desktop --locked
node python-desktop/build-web.mjs
uv run --project python-desktop --locked python -X utf8 python-desktop/main.py
uv run --project python-desktop --locked python -X utf8 -m unittest discover -s python-desktop/tests -v
uv run --project python-desktop --locked python -X utf8 python-desktop/build.py
uv run --project python-desktop --locked python -X utf8 python-desktop/package.py
```

`main.py` 是实际应用启动命令，使用源码目录旁的 `data`；不要为了验证环境随意启动并登录。迁移验证使用单独的临时数据目录。`package.py` 遇到已有同版本 ZIP 会拒绝覆盖，需先保留旧包或移入回收站。

## 依赖维护

- `.python-version` 固定 Python 3.13.6；`requires-python` 将依赖解析限制在 Python 3.13，支持平台限制为 Windows x64。
- `pyproject.toml` 声明运行依赖，`dev` 组声明 PyInstaller 与 setuptools。默认 `uv sync` 包含开发依赖。
- 首次迁移用 `constraint-dependencies` 保留原有全部 24 个包的版本；没有顺便升级依赖。
- `uv.lock` 记录解析结果，应与 `pyproject.toml`、`.python-version` 一起提交。`.venv`、业务数据和本地备份不应提交。
- 新增依赖：`uv add --project python-desktop 包名`；新增开发依赖加 `--dev`。
- 升级原有包时，先更新 `pyproject.toml` 中对应的直接依赖及 `constraint-dependencies` 版本，再执行 `uv lock --project python-desktop`、`uv sync --project python-desktop --locked` 并验证。只改直接依赖会与旧约束冲突。
- 2026-09-21 仓库整理后，旧 `requirements.txt` 已移入回收站。需要供 pip 使用的清单时，先创建 `.verification` 目录，再执行 `uv export --project python-desktop --locked --format requirements-txt --no-hashes --no-emit-project --output-file .verification/requirements-export.txt`，以锁文件为唯一依赖来源。

## 回退

1. 正常退出所有使用 `python-desktop/.venv` 的程序和终端任务。
2. 将当前 `.venv` 先改名保留，再把备份 `python-desktop/.venv` 复制回原位置。
3. 从备份恢复 `README.md` 和 `requirements.txt`；将新增的 `pyproject.toml`、`uv.lock`、`.python-version`、本说明先移到别处保留。业务源码未因本次迁移改动，无须覆盖。
4. 使用备份 README 中的原 `.venv/Scripts/python.exe` 命令开发和打包。

回退不要覆盖 `data`、原有发布目录或云端数据。根目录的“启动桌面工作台.cmd”及其启动目标未因迁移更改。

## 本次验证

干净 uv 环境按锁文件安装成功，24 个依赖版本与旧环境一致；45 项现有 Python 测试通过；隔离目录中的 EXE 构建、无 Python/Node PATH 的后端启动和 ZIP 完整性检查通过。分发包不含用户 data。现有发布指针和业务代码保持原样。本次未进行桌面窗口视觉验收或真实云端写入。详细结果见 `verification/uv-migration-result.json`。
