# Workbench — Repository-Level Local Task Workbench

> The single local web surface for this repository: create PPT generation
> tasks, watch a run, answer the one
> decision a run is waiting on, and pick up the delivered file. One instance
> serves every project on one port. The server never runs generation and never
> calls any model: the executing AI agent owns the run, and both sides meet at
> files on disk.

## Authority and Scope

| Concern | Owner |
|---|---|
| Task lifecycle, `task.json` schema, writer boundaries | This document |
| Server launch / shutdown behavior, port and lock behavior | This document |
| HTTP API for humans and agents | This document |
| Project surfaces: mount paths, prefix behavior, process ownership | This document |
| Confirmation page fields, receipts, catalogs | [`confirm_ui.md`](confirm_ui.md) |
| Preview editor behavior and annotations | [`svg_editor.md`](svg_editor.md) |
| Spec review blocks, drafts, comments | [`spec_review.md`](spec_review.md) |
| Run state format (`.runtime/`), event types, request/response files | [`agent_bridge.md`](agent_bridge.md) |
| How the agent consumes a submitted task inside a Generate profile | [`routing.md`](../../workflows/routing.md) row pointing here |
| Live SVG editing and annotation | [`svg_editor.md`](svg_editor.md) |

**Hard rule — one state, one writer.** `task.json` holds the user's decisions
and nothing else; the server is its only writer. Run state lives in
`<project>/.runtime/`; the agent is its only writer. The two halves are joined
by a task id the agent records, never by a second copy of the run state.

## `workbench/server.py`

```bash
uv run python scripts/workbench/server.py                  # foreground, auto-open browser
uv run python scripts/workbench/server.py --port 7071      # exact port, fail when taken
uv run python scripts/workbench/server.py --no-browser     # remote access via port forwarding
uv run python scripts/workbench/server.py --daemon         # background, return once reachable
uv run python scripts/workbench/server.py --timeout 0      # disable idle auto-shutdown
uv run python scripts/workbench/server.py --shutdown       # stop the running instance (idempotent)
```

- Repository-level singleton: no project argument. The runtime root is
  `projects/.workbench/` (already covered by the `projects/*` gitignore entry
  and skipped by project scanners as a dot directory).
- Without `--port`, binds the first free port from `127.0.0.1:7070`. It is the
  only local surface, so the range is kept away from the ad-hoc ports other
  tooling picks. `--port N` is exact and fails when unavailable.
- `--daemon` starts a detached child (browser opening suppressed in the child),
  waits until `GET /api/health` identifies this service against the lock, then
  opens the browser and returns. There is **no wait mode**: the workbench has
  no agent-blocking receipt lifecycle. The agent checks submitted tasks when
  the user asks it to process them (see the routing row).
- Lock at `projects/.workbench/workbench.lock` (`{pid, port}`); duplicate
  launches are refused, stale locks (dead pid) are overwritten.
- Idle auto-shutdown is disabled by default; arm one with `--timeout <seconds>`.
  `/api/shutdown` exits gracefully and releases the lock.
- Daemon child log: `projects/.workbench/server.log`.
- Exit codes: `0` success, `1` runtime error (bad directory, launch failure,
  duplicate instance), `2` argument error.

## Two facades, one state

| Audience | How it arrives | What it gets |
|---|---|---|
| Human | the single-page app in a browser | task list, editor, live run view, inbox with answer buttons, project surfaces (confirm / preview / spec), exports, feedback |
| Agent | the JSON routes below | run state read, the pending request with its options, and the answer write |

The agent never needs the browser, and the browser never needs to know where
the agent is. Both read the same files; neither holds state of its own.

## HTTP API

Task surface (server writes `task.json`; frozen once submitted):

| Method and path | Result |
|---|---|
| GET `/` | Workbench single-page app shell |
| GET `/api/health` | `{status, service: "workbench", pid, repo_root, projects_root, task_count}` |
| POST `/api/shutdown` | Graceful exit `{status: "ok"}` |
| GET `/api/options` | Option universe: `canvas` (synced live from `config.CANVAS_FORMATS`, labels from `static/options.json`), `page_counts`, `image_policies`, `languages` |
| GET `/api/tasks` | `{tasks: [...]}` newest-first summaries with derived `status` and a `runtime` block; corrupt records appear with `status: "error"` |
| POST `/api/tasks` | `{topic, display_title?, params?}` → `201 {task_id}`; creates a draft |
| GET `/api/tasks/<id>` | The user-domain record plus derived `status`, `runtime`, and `uploads_present` |
| PATCH `/api/tasks/<id>` | Merge user-domain fields (draft only; 409 once submitted) |
| POST `/api/tasks/<id>/uploads` | Multipart files → `201 {uploads: [{name, size}]}` (draft only; raw staging, never converts) |
| DELETE `/api/tasks/<id>/uploads/<name>` | Remove one staged file (draft only) |
| POST `/api/tasks/<id>/submit` | Freeze the user domain → `{status: "submitted", agent_hint}` |
| GET `/api/tasks/<id>/progress` | Derived read-only view: `status`, `runtime`, `events`, `requests`, `slides`, `quality`, `exports`, `confirm` |
| GET `/api/tasks/<id>/slides/<name>` | One page SVG (numeric-prefix name whitelist) |
| GET `/api/tasks/<id>/exports/<name>` | One exported PPTX download (`.pptx` whitelist, attachment) |
| GET `/api/tasks/<id>/images/<path>` | One project image asset so inline page previews resolve |
| POST `/api/tasks/<id>/requests/<req_id>` | Answer one inbox request through the task the browser is showing |
| GET/POST `/api/tasks/<id>/feedback` | Read / write `feedback.json` (allowed at any status) |

Run surface (read-only except the answer; nothing here writes project files):

| Method and path | Result |
|---|---|
| GET `/api/projects` | `{projects: [{slug, project_dir, task_id, state, stage, stage_index, stage_label, progress, route, profile, blocking, error, run_id, updated_at, lease_expires_at}]}` |
| GET `/api/projects/<slug>` | `{slug, project_dir, status, events, requests}` — the full run view, recent events, and the inbox |
| POST `/api/projects/<slug>/requests/<req_id>` | `{status?, choice?, text?}` → `{response}`; 409 when already answered |


The server binds `127.0.0.1` only and rejects foreign `Host`/`Origin`
headers with 403, matching the other local preview servers.

## Project surfaces

The confirmation, preview, and spec-review pages are **not separate services**.
Each is a Flask app mounted inside this one, on this one port, under the
project's slug:

| Surface | Mount path | What the human does there |
|---|---|---|
| Confirmation | `/p/<slug>/confirm/` | Stage 1 contract + template choice; final Stage 2 |
| Preview | `/p/<slug>/preview/` | watch pages land, direct-edit, annotate |
| Spec review | `/p/<slug>/spec/` | block drafts, comments, apply |

`surface_mount.py` owns the routing. A surface app is built lazily per project
with `embedded=True`, which disables its idle watchdog and turns
`/api/shutdown` into a no-op: **no browser view can end the shared process**.
Surfaces keep their own absolute `/api/...` routes and never learn the prefix,
because two adjustments make the browser agree:

- served HTML gets its `/static/` references rewritten to relative ones, so
  assets resolve under the mount;
- `static/surface_base.js` (served by this app) runs before the surface code and
  prefixes leading-slash `fetch`/`XMLHttpRequest` calls.

Page SVGs reference images as `../images/x.png`; from `/p/<slug>/preview/` that
resolves to `/p/<slug>/images/x.png`, so the mount also routes that path into
the preview app's `/images/` handler.

The agent needs two small CLIs, never a server:

```bash
python3 scripts/confirm_ui/wait.py <project> --stage stage1    # 0 confirmed, 1 not ready, 124 timeout
python3 scripts/spec_review/hold.py <project> on|off           # review-write hold
```

## Template choice lives in Stage 1

The workbench does not carry, preselect, or persist a template, brand, style,
or layout. A task records only the user's own brief; which template workspace to
use is decided on the confirmation page's Stage 1, where the four registered
kinds are browsed with real previews, or the run continues as free design.

That keeps one truth: `task.json` never disagrees with the confirmed choice, and
a template is installed from the Stage-1 receipt, not from the task.

## Task File Bus

One directory per task under `projects/.workbench/tasks/<task_id>/`:
`task.json` (the user domain), `uploads/` (raw staged material), and
`feedback.json` (post-delivery feedback). Task ids are generated ASCII
(`t<YYYYMMDD>-<HHMMSS>-<4 hex>`); user text lives only in JSON values, so
Chinese titles never become path segments.

### Lifecycle

```
draft ──submit(server)──> submitted ──agent claims──> processing ──agent──> done
                                                        │
                                                        └──> failed / interrupted
```

`draft` and `submitted` are decided by the server: a draft has no
`submitted_at`, a submitted task has one. Everything after that is derived
from the run view (see below), so there is no status field to drift.

### Derived status

| Derived | When |
|---|---|
| `draft` | `task.json` has no `submitted_at` |
| `submitted` | submitted, but no project declares this task id yet |
| `processing` | the declared project's run state is `running` or `waiting_user` |
| `interrupted` | the run's lease expired (the agent died mid-run) |
| `done` / `failed` | the run ended with that outcome |
| `error` | `task.json` is unreadable |

`interrupted` is never written anywhere; it is the run projection's own
derivation, applied at read time by [`agent_bridge.effective_state`](agent_bridge.md).

### Writer boundaries

| Field group | draft | after submit | Writer |
|---|---|---|---|
| `display_title`, `topic`, `requirements`, `params`, `uploads` | server (PATCH/POST/DELETE) | frozen (server returns 409) | server |
| `submitted_at` | server, on submit only | frozen | server |
| stage, progress, events, blocking request, error, exports | never present | read from `<project>/.runtime/` + project tree | agent |

Both sides publish with a temporary file plus an atomic replace (shared
helper: `scripts/atomic_io.py`). The server re-reads `task.json` from disk on
every request and re-derives the run view, so agent write-backs are visible
without restart.

### task.json v3 schema

```jsonc
{
  "schema_version": 4,
  "task_id": "t20261015-143022-a1b2",
  "created_at": "2026-10-15T14:30:22",
  "submitted_at": null,               // set once, on submit
  "updated_at": "…",

  "display_title": "Q3 汇报",
  "topic": "非空任务主题",
  "requirements": {"audience": "", "tone": "", "extra": ""},
  "params": {
    "canvas": "ppt169",               // config.CANVAS_FORMATS key
    "page_count": null,               // hint, not a hard constraint
    "primary_language": "zh-CN",
    "speaker_notes": false,
    "image_policy": "auto"            // auto|none|web|ai (hint)
  },
  "uploads": [{"name": "需求文档.docx", "size": 12345}]   // snapshot taken at submit
}
```

There is deliberately no `status`, `project_dir`, `agent_log`, `error`,
`deliverables`, or `template_selection` key. Records carrying them are normalized on read: only the
fields above survive, so an older file cannot smuggle run state back in.

The browser submits template selections as `(kind, id)` pairs only; the
server resolves each `workspace_root` from the registered library indexes,
so an arbitrary path can never enter a task. `indexes_sha256` fingerprints
the four index files at selection time so the agent can warn (never block)
when the template library changed after the user chose.

`feedback.json`: `{schema_version: 1, rating: 1-5|null, comment,
wants_revision, submitted_at}` — written by the browser at any status; the
agent reads it when the user asks for a revision.

## Agent Consumption Contract

The routing row in `workflows/routing.md` points here. When the user asks to
process a workbench task, the agent runs this playbook inside the Generate
route with its normal Confirm UI stages.

1. **Claim**: read `projects/.workbench/tasks/<task_id>/task.json` and
   `GET /api/tasks/<task_id>` (or the file plus the project tree). Proceed only
   when the derived status is `submitted`; `draft`, `processing`, `done`, or
   `failed` mean the task is not yours to take — say so and stop. There is no
   claim write: submitting already froze the user domain, and the run itself
   is what proves a claim.
2. **Initialize**: `project_manager.py init <slug> [--format <canvas>]` with a
   slug derived from `display_title`/`topic` (ASCII-safe, dated by the tool
   itself); pass `--format` only when `params.canvas` names a registered
   canvas key.
3. **Bind the run**: `agent_bridge.py run start --route generate --task
   <task_id>`. This one flag is the entire link between the task and the
   project: the workbench derives status by finding the project whose
   `.runtime/status.json` carries that id. Every later `stage` / `progress` /
   `ask` call is the normal bridge contract in [`agent_bridge.md`](agent_bridge.md).
4. **Material**: `project_manager.py import-sources <project> <task>/uploads/*`
   when uploads exist — its move semantics carry the staged files into
   `sources/`; conversion and any research then follow the selected profile's
   normal source-intake rules.
5. **Templates**: nothing to install from the task. Stage 1's confirmed
   choice is either free design or ≥1 workspace root; when it names roots,
   the page hands them to [`apply-template-workspace.md`](../../workflows/stages/apply-template-workspace.md)
   before Stage 2, and the run reads only the project-local `templates/`
   afterwards.
6. **User domain is explicit**: `topic`, `requirements`, and `params`
   (language, page count, canvas, image policy, speaker notes) are the user's
   stated requirements for this run — honor them as explicit requests in the
   profile's normal confirmation/spec mechanics; they are hints the profile
   reconciles with its own gates, not replacements for them.
7. **Report back**: the workbench reads the run view, so there is nothing to
   write back into `task.json`. Keep `stage` current, publish `progress` as
   pages land, and end the run with `run end --outcome done|failed` — that
   single call is what marks the task delivered or failed. Exports appear in
   the task view as soon as Step 7 writes them.
8. **Feedback**: when the user asks for a revision, read `feedback.json`
   (`wants_revision`, `comment`) alongside the task record, then start a new
   run bound to the same task id.

## Progress View

The progress endpoint is pure derivation over the run view and the project
tree. Slides are recognized by the numeric-prefix naming contract (`P01.svg`,
`01_cover.svg`), exports by the `.pptx` suffix, the pending decision by the
inbox, and the confirm panel state comes from the project's
`confirm_ui/session.json` when a Default-profile task runs one. The browser
polls every 2 s while the task is open and stops once the status is `done` or
`failed`, then offers the feedback card.

The inbox card is the one place the human writes back into a run: choosing an
option posts to `POST /api/tasks/<id>/requests/<req_id>`, which calls
`agent_bridge.answer_request` so the response file — not the HTTP handler —
remains the record.

## Frontend regression checks

Manual checklist, run on a disposable checkout:

1. `uv run python scripts/workbench/server.py` opens the browser at the logged URL.
2. The task list renders; creating a task from a topic jumps to its detail page.
3. The detail form edits params, uploads a file, and the file appears in the list.
4. The detail form carries no template control: submitting shows the copyable
   agent hint, and afterwards the page is a read-only summary.
5. The confirmation surface is the only place a template is chosen; its Stage 1
   lists the four registered kinds with real previews, and its Stage 2 follows
   in the same page without a reload.
6. After the final confirmation the page offers 查看任务进度 and 打开页面预览
   instead of a dead "you can close this page" overlay.
7. With a hand-attached fake project (`agent_bridge.py run start --task
   <task_id>` in a scratch project plus a few `svg_output/*.svg` and one
   `exports/*.pptx`), the progress page renders stage, events, page
   thumbnails, the export download link, and the inbox card; answering it
   writes `resp-NNNN.json` and the card turns into 已回复; stars/rating
   feedback lands in `feedback.json`.
8. `curl http://127.0.0.1:<port>/api/projects` lists the scratch project with
   its stage and progress, and `GET /api/projects/<slug>` returns events and
   the inbox.
9. `curl -H "Host: evil.example" http://127.0.0.1:<port>/api/health` returns 403.
10. `uv run python scripts/workbench/server.py --shutdown` returns 0 twice in a row.

## Remote access

Run with `--no-browser` and forward the port over SSH; the server binds
loopback only, so the tunnel endpoint is the sole exposure.
