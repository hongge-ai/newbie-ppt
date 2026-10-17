# setup_env.py — 一键环境配置

`setup_env.py` 是 newbie-ppt 的一键安装入口：引导安装 uv（若缺失）、按 pyproject.toml
的分层清单同步依赖、逐组校验导入。面向国内新手，默认全量安装并走清华镜像。

## 快速开始

```bash
# 仓库根目录执行（需要本机已有可用的 Python 3.10+）
python skills/ppt-master/scripts/setup_env.py
```

输出末尾会给出工作台启动与仓库更新命令。整个过程无需手动激活虚拟环境——
uv 会在仓库根目录维护 `.venv`，后续统一用 `uv run python ...` 调用脚本。

## 前置条件

- Python 3.10+（python.org 安装时勾选 "Add python.exe to PATH"；Windows 若只装了
  Microsoft Store 的 python 占位程序，本脚本会静默失败，请先装真正的 Python）
- git（仅仓库更新时需要）
- uv 不需要预装：脚本会按「PATH → winget（Windows）/ 官方安装脚本（macOS、Linux）
  → 当前解释器 pip」的顺序引导安装，全部失败时打印手动指引

## 依赖分层

单一事实源是仓库根 `pyproject.toml`；`uv.lock` 锁定具体版本，两者变更由
`update_repo.py` 指纹跟踪。

| 层 | 内容 | 说明 |
|----|------|------|
| core | PyYAML、python-pptx、skia-pathops、uharfbuzz、Pillow、flask、requests | 主链路：工作台 → 生成 → PPTX 导出 |
| `pdf` | PyMuPDF | **AGPL-3.0**，仅 PDF 源导入用到，见下方许可说明 |
| `web` | beautifulsoup4、curl_cffi | 网页/微信文章导入（curl_cffi 缺省回退 requests） |
| `office` | mammoth、markdownify、ebooklib、nbconvert、openpyxl、XlsxWriter | docx/html/epub/ipynb/xlsx 导入与导出图表工作簿 |
| `media` | edge-tts、numpy | 旁白音频、计时校准、切片等媒体工具 |
| `ai-image` | google-genai | Gemini AI 图像后端（`IMAGE_BACKEND=gemini`） |

## 参数

```bash
python skills/ppt-master/scripts/setup_env.py                # 默认：core + 全部可选组
python skills/ppt-master/scripts/setup_env.py --core         # 仅核心（不含 PyMuPDF）
python skills/ppt-master/scripts/setup_env.py --group pdf,web
python skills/ppt-master/scripts/setup_env.py --list-groups  # 列出分组说明并退出
```

同步语义为**只增不删**（`uv sync --inexact`）：后补装某组不会卸掉已装的其他组。
如需按当前选择裁剪（删除多余包），手动执行 `uv sync --all-groups`（或对应组）。

## PyMuPDF 许可说明（AGPL-3.0）

默认全量安装会包含 PyMuPDF。它是本仓库唯一的 AGPL 依赖，仅
`source_to_md/pdf_to_md.py` 导入：用 `--core` 或不带 `pdf` 组安装可完全避开；
pip 从镜像自装不构成再分发，但若要把含 PyMuPDF 的依赖包随你的产物一起分发，
请先核对 AGPL 条款（详见 [conversion.md](conversion.md)）。

## 镜像与网络

- 默认 index 固化在 pyproject.toml（清华 `https://pypi.tuna.tsinghua.edu.cn/simple`），
  `uv sync` 零配置走国内源，且与 uv.lock 记录一致、不会触发重锁
- 清华不可达等场景属于高级操作：`uv sync --default-index <url>` 临时换源——
  注意这会按新源**重写 uv.lock**，确认后再提交或还原，本脚本不提供该开关
- uv 托管 Python 的下载如需加速，可设
  `UV_PYTHON_INSTALL_MIRROR=<python-build-standalone 镜像地址>`

## 维护者：增删依赖

```bash
uv add "package>=x.y"                 # 加入 core
uv add --group pdf "package>=x.y"     # 加入某个可选组
uv remove [--group <组>] package
uv lock                               # 重新解析并更新 uv.lock
```

改动 pyproject/uv.lock 后记得连同提交——`update_repo.py` 依据两者哈希决定是否
在用户侧触发 `uv sync --inexact`。

## 与 update_repo.py 的关系

| 场景 | 命令 |
|------|------|
| 首次安装 / 换机重装 | `setup_env.py`（全量或按组） |
| 日常更新仓库与依赖 | `uv run python skills/ppt-master/scripts/update_repo.py` |
| 只拉代码不动依赖 | 同上，加 `--skip-deps` |

zip 分发的用户仓库内没有 `.git`，`update_repo.py` 会提示改为下载新版精简包后重跑
`setup_env.py`。
