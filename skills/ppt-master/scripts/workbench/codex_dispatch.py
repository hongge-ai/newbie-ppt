#!/usr/bin/env python3
"""Launch a workspace-scoped Codex process for a dispatched PPT task."""

import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

from server_common import popen_detached


AGENT_ID = 'codex-local'


def executable() -> str | None:
    installed = shutil.which('codex')
    if installed and os.name == 'nt' and Path(installed).suffix.lower() == '.cmd':
        # npm's Windows shim can lose redirected handles when Node starts its native child.
        npm = Path(installed).parent / 'node_modules' / '@openai' / 'codex'
        arch = 'arm64' if platform.machine().lower() in ('arm64', 'aarch64') else 'x64'
        package = npm / 'node_modules' / '@openai' / ('codex-win32-' + arch)
        for vendor in (package / 'vendor', npm / 'vendor'):
            native = next(vendor.glob('*-pc-windows-msvc/bin/codex.exe'), None)
            if native:
                return str(native)
    if installed:
        return installed
    bundled = os.environ.get('CODEX_APP_RUNTIME_CLI_PATH')
    if bundled and Path(bundled).is_file():
        return bundled
    return None


def launch(cli: str, repo: Path, log_path: Path, prompt: str) -> subprocess.Popen:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    # Desktop runtime handles belong to the originating app session. A standalone
    # CLI provisions its own workspace-write sandbox and resolves its own shell.
    for key in ('CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_APP_TOOLS_PIPE_PATH',
                'CODEX_PERMISSION_PROFILE', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'CODEX_APP_RUNTIME_CLI_PATH',
                'CODEX_WINDOWS_REGISTERED_CORE', 'CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY', 'CODEX_SHELL'):
        env.pop(key, None)
    # A file-backed stdin survives server restarts and keeps the prompt out of the command line.
    with tempfile.TemporaryFile() as source, log_path.open('wb') as log:
        source.write(prompt.encode('utf-8'))
        source.seek(0)
        return popen_detached(
            [cli, 'exec', '--sandbox', 'workspace-write', '--color', 'never', '-'],
            cwd=repo, env=env, stdin=source, stdout=log, stderr=subprocess.STDOUT,
        )
