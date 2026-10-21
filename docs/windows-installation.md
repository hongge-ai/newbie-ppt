# Windows Installation Guide

[English](./windows-installation.md) | [Chinese](./zh/windows-installation.md)

---

This guide walks you through installing newbie-ppt on Windows step by step. Follow along and you'll have a working setup in under 10 minutes.

---

## Step 1 — Install Python (Required)

Python is the only hard requirement.

1. Go to **[python.org/downloads](https://www.python.org/downloads/)** and download the latest **Python 3.14** installer.

2. **⚠️ CRITICAL: Check "Add python.exe to PATH"** during installation — this is the single most common mistake on Windows. Skipping this will break every step that follows.

3. After installation, open **PowerShell** (search "PowerShell" in Start menu) and verify:

   ```powershell
   python --version
   ```

   You should see `Python 3.14.x` or similar. If you see "Python was not found" or it opens the Microsoft Store, see [Troubleshooting](#python-was-not-found-or-opens-microsoft-store) below.

> **💡 Tip**: Python installed via Anaconda or Miniconda works too — just make sure `python --version` shows 3.14.x.

---

## Step 2 — Download the Project

**Option A — Download ZIP** (easiest):

1. Go to [github.com/hongge-ai/newbie-ppt](https://github.com/hongge-ai/newbie-ppt)
2. Click the green **Code** button → **Download ZIP**
3. Unzip to `C:\Users\YourName\newbie-ppt`

**Option B — Git Clone** (requires [Git](https://git-scm.com/downloads)). Run:

```powershell
git clone https://github.com/hongge-ai/newbie-ppt.git
```

Then enter the cloned folder:

```powershell
cd newbie-ppt
```

---

## Step 3 — One-click Setup

The setup script bootstraps [uv](https://docs.astral.sh/uv/) (installing it via winget if missing), creates the `.venv`, and installs all layered dependencies — through the Tsinghua PyPI mirror by default:

```powershell
cd C:\Users\YourName\newbie-ppt   # ← adjust to your actual path
python skills/ppt-master/scripts/setup_env.py
```

Wait for it to finish. You should see one `[ok] <group>` line per dependency group at the end.

---

## Step 4 — Verify Your Setup

```powershell
uv run python -c "import pptx; import fitz; print('All core dependencies OK')"
```

✅ Output: `All core dependencies OK` → you're good.

❌ Error → see [Troubleshooting](#troubleshooting) below.

---

## Step 5 — Run a Minimal Example

Open the `newbie-ppt` folder in an agent-capable AI tool (Claude Code, Codex, Cursor, a VS Code agent, etc.) and type in the chat:

```
Turn this into a simple 3-page test PPT with a cover, one content page, and a closing page. Topic: "Hello World".
```

Confirm the three-page design spec when Stage 1 and Stage 2 ask, then the AI authors and exports. The point of this smoke test is that project initialization, SVG authoring, validation, and export all work end to end.

When it finishes, you should see:

- A native DrawingML `.pptx` under `exports/`, generated from `svg_output/`, that opens in PowerPoint and remains editable element by element.

That's the check that matters — if the file is there and opens, **you're done.** The run also produces `svg_final/`, containing self-contained visual-preview SVGs. They may be inserted manually as SVG pictures, but manual "Convert to Shape" is outside the supported contract.

---

## Step 6 — Optional Enhancements (most users can skip this)

With the setup script finished, you already have everything needed to generate presentations. PPTX export writes native DrawingML shapes, so it does not require CairoSVG, GTK, or a separate SVG rasterization stack. The item below is an **edge-case fallback** — install it only if you hit the specific scenario.

| Enhancement | Install only if… | How to install | Verify |
|-------------|-----------------|----------------|--------|
| **Pandoc** — legacy document formats | You need to convert `.doc`, `.odt`, `.rtf`, `.tex`, `.rst`, `.org`, or `.typ`. `.docx`/`.html`/`.epub`/`.ipynb` work natively in Python. | Download `.msi` from [pandoc.org](https://pandoc.org/installing.html) | `pandoc --version` |

---

## Troubleshooting

### `python` was not found or opens Microsoft Store

**Cause**: Python isn't in your system PATH.

**Fix 1** — Re-run the Python installer → **Modify** → check **"Add Python to environment variables"**.

**Fix 2** — Manually add to PATH:
1. Run `where python` in PowerShell first to find the actual path (e.g. `C:\Users\YourName\AppData\Local\Programs\Python\Python312\python.exe`)
2. Search "Environment Variables" in Start menu
3. Find `Path` → **Edit** → add the **directory** from step 1 and its `Scripts` subfolder:
   ```
   C:\Users\YourName\AppData\Local\Programs\Python\Python312
   C:\Users\YourName\AppData\Local\Programs\Python\Python312\Scripts
   ```
4. Click OK, then **restart PowerShell**

**Fix 3** — Try `python3` or `py` instead.

### A `python3` command fails (exit 49 / opens Microsoft Store)

The python.org installer ships `python.exe` but not `python3.exe`. **Just replace `python3` with `python` in the command** (the AI agent usually switches to `python` and continues on its own too).

### Dependency installation fails with permission errors

The setup script routes everything through uv into the repo-local `.venv`, which needs no admin rights. If you went the manual `uv pip` route instead and hit permission errors, run PowerShell as Administrator — or simply return to the one-click script.

### Dependency installation fails due to network issues

The setup script already uses the Tsinghua PyPI mirror by default (pinned in pyproject.toml). If that mirror is unreachable, advanced users can switch index for one manual sync — note this rewrites uv.lock, so revert the file afterward:

```powershell
uv sync --all-groups --default-index https://mirrors.aliyun.com/pypi/simple/
# or the official index:
uv sync --all-groups --default-index https://pypi.org/simple
```

Behind a proxy, set it before running the script:

```powershell
$env:HTTPS_PROXY = "http://your-proxy:port"
```

### `ModuleNotFoundError`

Scripts must run inside the uv-managed environment — use `uv run python <script>` from the repo root (the setup script prints this form). A bare `python` pointing at another interpreter won't see the `.venv`.

### `import fitz` fails

The `pdf` group is installed by default; if you installed with `--core` and now need PDF import:

```powershell
uv sync --group pdf
```

If the install itself fails, force a pre-built wheel: `uv pip install PyMuPDF --only-binary :all:`. Still failing → install [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

### PowerShell says "running scripts is disabled"

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Still stuck?

- 📖 [FAQ](./faq.md)
- 🐛 [GitHub Issues](https://github.com/hongge-ai/newbie-ppt/issues) — include your Python version, Windows version, and full error message
- 💬 [GitHub Discussions](https://github.com/hongge-ai/newbie-ppt/discussions)
