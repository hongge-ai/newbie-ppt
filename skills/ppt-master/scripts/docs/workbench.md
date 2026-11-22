# Workbench — Repository-Level Local Task Workbench

> The single local web surface for this repository: create PPT generation
> tasks, watch a run, answer the one
> decision a run is waiting on, and pick up the delivered file. One instance
> serves every project on one port. The server dispatches tasks to AI clients
> or starts a local Codex CLI process. The executing agent owns generation
> and reports progress through the project files.

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
uv run python scripts/workbench/server.py                  # open the workbench; AI sessions also attach
uv run python scripts/workbench/server.py --port 7071      # exact port, fail when taken
uv run python scripts/workbench/server.py --no-browser     # remote access via port forwarding
uv run python scripts/workbench/server.py --daemon --service-only  # start the web service and return
uv run python scripts/workbench/server.py --timeout 0      # disable idle auto-shutdown
uv run python scripts/workbench/server.py --shutdown       # stop the running instance (idempotent)
```

- Repository-level singleton: no project argument. The runtime root is
  `projects/.workbench/` (already covered by the `projects/*` gitignore entry
  and skipped by project scanners as a dot directory).
- Without `--port`, binds the first free port from `127.0.0.1:7070`. It is the
  only local surface, so the range is kept away from the ad-hoc ports other
  tooling picks. `--port N` is exact and fails when unavailable.
- Starting or attaching from Codex enables the installed Codex CLI for the
  current server instance. Each explicit dispatch starts an independent
  workspace-write session in the repository and returns immediately. Its
  assignment records the process ID, attempt and exit status; execution logs
  live in `projects/.workbench/jobs/<task_id>/<attempt>.log`. The web route
  supplies the repository's Generate instructions and the validated task ID.
  Repeated dispatches reuse the active attempt. An unfinished task can be
  retried after its process exits, reusing an existing project binding.
- Claude Code and other one-shot clients keep the attach call pending and
  consume the assigned-task JSON. Use `--service-only` to start a preview
  during an existing run.
- In a regular terminal the server runs in the foreground by default.
  `--daemon` starts a detached server, checks its health, and returns.
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
| GET / PUT `/api/settings/image` | Read the effective image URL, masked key and model, or save an explicit connection. New configurations start with ZhenZhen AI. A custom base URL uses the OpenAI-compatible image protocol. Changing the address requires a key for the new endpoint. |
| POST `/api/settings/image` | Reveal the current endpoint's key on an explicit user request, or read the ZhenZhen AI price snapshot. Opening settings starts one asynchronous estimate refresh per configured key and local calendar day. Later reads use the stored snapshot, including after a failed refresh. Estimates are CNY per 16:9 image, rounded upward to two decimals. |
| POST `/api/shutdown` | Graceful exit `{status: "ok"}` |
| GET `/api/options` | Option universe: `canvas` (synced live from `config.CANVAS_FORMATS`, labels from `static/options.json`), `page_counts`, `image_policies`, `languages` |
| GET `/api/settings/image?view=status` | Returns `{configured}` for the task form, based on the active backend and presence of a matching API key. |
| GET `/api/tasks` | `{tasks: [...]}` newest-first summaries with derived `status` and a `runtime` block; corrupt records appear with `status: "error"` |
| POST `/api/tasks` | `{topic, display_title?, params?}` → `201 {task_id}`; creates a draft |
| GET `/api/tasks/<id>` | The user-domain record plus derived `status`, `runtime`, and `uploads_present` |
| PATCH `/api/tasks/<id>` | Merge user-domain fields (draft only); after submit only `display_title` is accepted, anything else is 409 |
| POST `/api/tasks/<id>/uploads` | Multipart files → `201 {uploads: [{name, size}]}` (draft only; raw staging, never converts) |
| DELETE `/api/tasks/<id>/uploads/<name>` | Remove one staged file (draft only) |
| POST `/api/tasks/<id>/submit` | Freeze the user domain → `{status: "submitted", agent_hint}` |
| GET `/api/tasks/<id>/progress` | Derived read-only view: `status`, `runtime`, `events`, `requests`, `slides`, `quality`, `exports`, `outline` (`{exists, status, round, title, slide_count}`), `confirm`, `plan` (`{review_due, confirmed}`) |
| GET `/api/tasks/<id>/outline` | Slide-by-slide outline (`<project>/outline.md`) and review state (`confirm_ui/outline_state.json`): `{available, status: "missing"\|"ready"\|"revising"\|"confirmed", round, title, summary, slide_count, markdown, outline_sha256, pending_revision}` |
| PUT `/api/tasks/<id>/outline` | `{markdown, display_title?}` → direct user edits (single-slide edit, add/delete/reorder) persisted to `outline.md` (`409` while `status == "revising"`) |
| POST `/api/tasks/<id>/outline/revise` | `{comments: [{id, slide, slide_title, quote, comment}], global_note?, markdown?}` → sets `status: "revising"` in `outline_state.json` to wake `confirm_ui/wait.py --stage outline` |
| POST `/api/tasks/<id>/outline/confirm` | `{markdown?, display_title?}` → freezes `outline.md` as `status: "confirmed"` and syncs `display_title` in `task.json` |
| GET `/api/tasks/<id>/proposal` | The AI's Stage-1 proposal, proxied from the mounted confirmation surface plus localized display metadata, `outline` summary, and `outline_preview` copy snippets: `{available, contract, constraints, outline, outline_preview, preferred_visual_style, preview, template_options, template_meta}` or `{available: false, reason, stage1_confirmed, delegate_stage2, preferred_visual_style}` |
| POST `/api/tasks/<id>/proposal/reopen` | Clear Stage-1 confirmation receipts before slides exist (`409` once `svg_output/` has pages) so the user can re-pick a visual style or template |
| POST `/api/tasks/<id>/confirm` | The Stage-1 confirmation: `{display_title, contract, template_mode, selection_keys, options_sha256, skip_stage2_review?, preferred_visual_style?}` → the title lands in `task.json`, `skip_stage2_review` and `preferred_visual_style` land in `confirm_ui/workbench_prefs.json` (read as `delegate_stage2` and `preferred_visual_style` by `wait.py --stage stage1`), and the rest goes to the surface that owns `result.json`. Supports both `free_design` (`selection_keys: []` with any of the 18 catalog `visual_styles`) and `templates` (≥1 workspace key). Stage 2 submits through the embedded surface when not delegated |
| GET `/api/tasks/<id>/slides/<name>` | One page SVG (numeric-prefix name whitelist) |
| GET `/api/projects/<slug>/page-previews` | PowerPoint-rendered page roster shared by the thumbnail grid and full-screen viewer. The task progress endpoint includes it with `?preview=1`. |
| GET `/api/tasks/<id>/exports/<name>` | One exported PPTX download (`.pptx` whitelist, attachment) |
| POST `/api/tasks/<id>/exports/<name>/open` | Open the task's exported PPTX with the local default application |
| POST `/api/tasks/<id>/exports/<name>/save-as` | Native Save As dialog for browsers without a file picker. Cancellation returns `{saved: false}` |
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

## Agent presence and dispatch

A submitted task is handed to an agent, and the page never guesses which agents
exist. Agents announce themselves; the human always presses the dispatch.

| Piece | Shape |
|---|---|
| Presence | `POST /api/agents/register` → `agent_id`; `POST /api/agents/<id>/heartbeat`; `GET /api/agents` lists them. The waiting client unregisters with `DELETE /api/agents/<id>` on exit. A missing heartbeat for 45 s means offline. |
| Dispatch | `POST /api/tasks/<id>/assign` with `{agent_id}`. An unclaimed one-shot dispatch expires after 180 s. A background dispatch returns an accepted attempt; after exit, `retry: true` can restart an unfinished task. |
| Delivery | The agent polls `GET /api/agents/<id>/assignment`; a dispatched task returns its `task_id`, `task_file` and hint. |
| Command | `scripts/workbench_agent.py attach --name "<session>"` enables the background Codex runner or registers a one-shot client according to the calling environment. |

Before dispatch, **no agent** shows the attach
command with a copy button; **one agent** lists it with an
explicit 分派 button; **several** list them as a radio group and dispatch the
chosen one. Nothing is dispatched automatically, and one task never belongs to
two agents.

## Page map

| Route | Workspace |
|---|---|
| `#/new` | Curated examples with the cover and representative interior pages |
| `#/example/<id>` | All original pages, in order; browsing writes no task |
| `#/example/<id>/make` | Topic, material upload or both |
| `#/task/<id>` | Outline review, per-page progress, native preview and editable PPTX delivery |
| `#/task/<id>/preview` | PowerPoint-rendered pages of the generated presentation |

## Project surfaces

All browser UI rendering is owned by the single light-theme Workbench SPA
(`workbench/static/{app,slide_preview,stage2_confirm,style_slides}.js`). The
`confirm_ui` and `svg_editor` Flask backends are **not separate browser
services**; their API handlers are mounted inside this process under the
project's slug:

| Surface | API Mount Prefix | Legacy URL Redirect (`302`) | What the human does in Workbench |
|---|---|---|---|
| Confirmation | `/p/<slug>/confirm/api/...` | `/#/task/<id>/confirm` or `/#/project/<slug>/confirm` | Stage-1 fallback & full Stage-2 palette, typography, style, icon & image strategy confirmation |
| Preview | `/p/<slug>/preview/api/...` | `/#/task/<id>/preview` or `/#/project/<slug>/preview` | watch pages land, direct-edit attributes/geometry, annotate (`slide_preview.js`) |

`surface_mount.py` owns the routing. Each backend app is built lazily per
project with `embedded=True`, which disables its idle watchdog and turns
`/api/shutdown` into a no-op: **no client request can end the shared process**.
Legacy browser roots (`/p/<slug>/confirm/` and `/p/<slug>/preview/`) return a
`302` redirect to the corresponding Workbench SPA route (preserving `?slide=...`),
while `/p/<slug>/spec/` returns `404` because the legacy `spec_review` web UI is
retired.

Page SVGs reference images as `../images/x.png`; `WorkbenchSlidePreview`
rewrites those relative `href`s during SVG sanitization to
`/p/<slug>/images/x.png`, and `surface_mount.py` also keeps `/p/<slug>/images/...`
routed directly to the preview backend.

The agent needs small file-bus CLIs, never a per-project server:

```bash
python3 scripts/confirm_ui/outline_store.py <project> --publish            # publish outline.md as ready
python3 scripts/confirm_ui/wait.py <project> --stage outline               # 0 revising|confirmed, 1 not ready, 124 timeout
python3 scripts/confirm_ui/wait.py <project> --stage outline --publish-revision
python3 scripts/confirm_ui/wait.py <project> --stage stage1                # prints {stage, status, delegate_stage2}
```

## Curated examples

`GET /api/examples` exposes the bundled landscape examples in source order. Include a deck when its original page width exceeds its height. Each entry identifies the full set of original page previews, its official viewer and the canvas for a new task. On outline confirmation the workbench installs one of two production inputs:

- A curated Deck workspace installs its verified template receipt and structured prototypes. Use template-aware Stage 2.
- A source example installs the checksum-verified `example_reference.json`. It contains the original page SVG markup, preview locations and the source design notes when available. Use ordinary flat Stage 2. Inspect the cover and relevant interior compositions together with their previews. Ground the new spec and lock in the observed type, color, spacing, image framing and page hierarchy. Record the reference page used for each composition in the page plan. Use these source artifacts as design evidence. Select, repeat and adapt compositions for the approved outline, replace original facts and imagery, and author editable text, graphics and data on the task canvas.

Creating a curated task saves its allowlisted example ID. An upload-only draft can have an empty topic. Submission requires a topic or an uploaded file. A single available agent is dispatched on submission; an unavailable agent can attach later. Outline confirmation verifies the selected resource before publishing the confirmed outline, including on retry. Curated tasks delegate design decisions and continue directly to production. Standalone project confirmation and existing tasks without an example retain their own workflows.

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
| `display_title`, `topic`, `params`, `uploads` | server (PATCH/POST/DELETE) | frozen (server returns 409) | server |
| `submitted_at` | server, on submit only | frozen | server |
| stage, progress, events, blocking request, error, exports | never present | read from `<project>/.runtime/` + project tree | agent |

Both sides publish with a temporary file plus an atomic replace (shared
helper: `scripts/atomic_io.py`). The server re-reads `task.json` from disk on
every request and re-derives the run view, so agent write-backs are visible
without restart.

### task.json v5 schema

```jsonc
{
  "schema_version": 5,
  "task_id": "t20261015-143022-a1b2",
  "created_at": "2026-10-15T14:30:22",
  "submitted_at": null,               // set once, on submit
  "updated_at": "…",

  "display_title": "Q3 汇报",        // AI names it; the user may rename it any time
  "topic": "任务主题",
  "example_id": "bauhaus",            // selected by the user before composing
  "params": {
    "canvas": "ppt169",               // config.CANVAS_FORMATS key
    "page_count": null,               // hint, not a hard constraint
    "primary_language": "zh-CN",
    "speaker_notes": false,
    "image_policy": "ai"              // ai (default)|none|web; older records may use auto
  },
  "uploads": [{"name": "需求文档.docx", "size": 12345}]   // snapshot taken at submit
}
```

Audience, intent, core message, and delivery context are **not** task fields: the
AI authors them as the Stage-1 proposal, and the user edits them on the card
before confirming. Keeping them out of `task.json` is what stops the same fact
from having two editable homes.

There is deliberately no `status`, `project_dir`, `agent_log`, `error`,
`deliverables`, or `template_selection` key. Records carrying them are normalized on read: only the
fields above survive, so an older file cannot smuggle run state back in.

The browser submits an example ID. The server resolves its Deck from the curated catalog.

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
5. **Example selection**: for `example_id` follow [Curated examples](#curated-examples); the approved outline and installed design supply the production inputs. Select each composition to serve the new slide's content, replace sample material with current evidence, and map the chosen prototypes in the spec and lock. For an existing task without an example, resume its recorded confirmation workflow.

6. **User domain is explicit**: `topic` and `params`
   (language, page count, canvas, image policy, speaker notes) are the user's
   stated requirements for this run — honor them as explicit requests in the
   profile's normal confirmation/spec mechanics; they are hints the profile
   reconciles with its own gates, not replacements for them. Because they are
   constraints rather than proposals, never change them silently: a better value
   is only ever proposed back to the user.
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
polls every 2 s while the task is open, including while the final preview renders.

On Windows with desktop PowerPoint installed, each complete draft SVG can be
compiled into a temporary one-slide PPTX. A single background worker renders
it through PowerPoint. When the exported deck arrives, the worker renders a
read-only copy in presentation order and publishes all final pages together.
The grid thumbnail and full-screen image derive from the same PowerPoint raster.
Both are cached by source revision under `projects/.workbench/page-previews/`.
The full-screen viewer links to the SVG editor for direct edits and annotations.

The delivery viewer displays the generated pages alone.

The task progress response includes `image_progress`. Its `total` is unknown
until the image roster is available. The `ready` entries identify readable
planned files in the task image route, and `failed` and `manual` count
outstanding manifest items in those states.

The inbox card is the one place the human writes back into a run: choosing an
option posts to `POST /api/tasks/<id>/requests/<req_id>`, which calls
`agent_bridge.answer_request` so the response file — not the HTTP handler —
remains the record.

## Frontend regression checks

Open the gallery and browse the full source without creating a task. Submit a topic-only task and an attachment-only task. Verify that confirming the outline installs the selected example, and that repeated confirmation leaves the same template receipt. Check per-page previews and the open and save actions against the final export.

## Remote access

Run with `--no-browser` and forward the port over SSH; the server binds
loopback only, so the tunnel endpoint is the sole exposure.






