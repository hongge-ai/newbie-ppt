# Workbench — Repository-Level Local Task Workbench

> The local web surface for creating PPT generation tasks, browsing and
> previewing the registered template library, configuring generation
> parameters, and watching progress. One instance serves the whole
> repository. The server never runs generation and never calls any model:
> the executing AI agent consumes submitted task files and writes status
> back through the same file bus.

## Authority and Scope

| Concern | Owner |
|---|---|
| Task lifecycle, task.json schema, writer boundaries | This document |
| Server launch / shutdown behavior, port and lock behavior | This document |
| Template enumeration and preview routing | This document |
| How the agent consumes a submitted task inside a Generate profile | [`routing.md`](../../workflows/routing.md) row pointing here |
| Template candidate preparation and two-stage confirmation | [`confirm_ui.md`](confirm_ui.md) (the workbench never replaces it) |
| Live SVG editing and annotation | [`svg_editor.md`](svg_editor.md) |

**Hard rule**: keep detailed workbench behavior here. Workflow files may
reference the workbench trigger in one row; they must not duplicate the task
schema or launcher lifecycle.

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
  `projects/.workbench/` (already covered by the `projects/*` gitignore
  entry and skipped by project scanners as a dot directory).
- Without `--port`, binds the first free port from `127.0.0.1:7070` — a
  dedicated range so stale workbench tabs can never address a Confirm UI
  (5050) or live preview (6060) process. `--port N` is exact and fails when
  unavailable.
- `--daemon` starts a detached child (browser opening suppressed in the
  child), waits until `GET /api/health` identifies this service, repository
  root, and child pid against the lock, then opens the browser and returns.
  Unlike the Confirm UI there is **no wait mode**: the workbench has no
  agent-blocking receipt lifecycle. The agent checks submitted tasks when
  the user asks it to process them (see the routing row).
- Lock at `projects/.workbench/workbench.lock` (`{pid, port}`); duplicate
  launches are refused, stale locks (dead pid) are overwritten.
- Idle auto-shutdown is disabled by default (the workbench is a long-lived
  cockpit; arm one with `--timeout <seconds>`); `/api/shutdown` exits
  gracefully and releases the lock.
- Daemon child log: `projects/.workbench/server.log`.
- Exit codes: `0` success, `1` runtime error (bad directory, launch failure,
  duplicate instance), `2` argument error.

## HTTP API

| Method and path | Result |
|---|---|
| GET `/` | Workbench single-page app shell |
| GET `/api/health` | `{status, service: "workbench", pid, repo_root, projects_root, task_count}` |
| POST `/api/shutdown` | Graceful exit `{status: "ok"}` |
| GET `/api/options` | Option universe: `canvas` (synced live from `config.CANVAS_FORMATS`, labels from `static/options.json`), `page_counts`, `image_policies`, `languages`, `profiles` |
| GET `/api/tasks` | `{tasks: [...]}` newest-first summaries; corrupt records appear with `status: "error"` |
| POST `/api/tasks` | `{topic, display_title?, params?}` → `201 {task_id}`; creates a draft |
| GET `/api/tasks/<id>` | Full task record plus `uploads_present` (live staged-file listing) |
| PATCH `/api/tasks/<id>` | Merge user-domain fields (draft only; 409 otherwise) |
| POST `/api/tasks/<id>/uploads` | Multipart files → `201 {uploads: [{name, size}]}` (draft only; raw staging, never converts) |
| DELETE `/api/tasks/<id>/uploads/<name>` | Remove one staged file (draft only) |
| POST `/api/tasks/<id>/submit` | Freeze the user domain → `{status: "submitted", agent_hint}` |
| GET `/api/templates` | Four-kind catalog `{brand: [], style: [], layout: [], deck: []}`; cards carry `kind`, `id`, `summary`, `workspace_root`, and the kind's index fields (`primary_color`/`keywords`/`canvas_format`/`page_count`/`page_types`) |
| GET `/api/templates/<kind>/<id>/preview` | `{kind, id, summary, frontmatter, roster: [{name, svg_url}], images_url_prefix, …}` — layout/deck list their roster SVGs; brand/style carry the parsed design_spec frontmatter |
| GET `/templates/<kind>/<id>/<path>` | One whitelisted file from a registered template workspace (SVG roster, images); unknown kind/id returns 404 |
| GET `/api/tasks/<id>/progress` | Derived read-only view: `slides` (svg_output, numeric-prefix names, ordered), `quality` (report presence), `exports` (pptx, newest first), `confirm` (from the project's confirm_ui/session.json when present), `agent_log`, `deliverables` |
| GET `/api/tasks/<id>/slides/<name>` | One page SVG (numeric-prefix name whitelist) |
| GET `/api/tasks/<id>/exports/<name>` | One exported PPTX download (`.pptx` whitelist, attachment) |
| GET `/api/tasks/<id>/images/<path>` | One project image asset so inline page previews resolve |
| GET/POST `/api/tasks/<id>/feedback` | Read / write `feedback.json` (allowed at any status) |
| GET `/api/custom-templates` | `{custom_templates: [...]}` newest-first; each card carries `id`, `name`, `summary`, `selections` (`{kind, id}` pairs), `invalid` (ids no longer in the official indexes), timestamps |
| POST `/api/custom-templates` | `{name, selections}` → `201` card; name ≤ 40 chars unique (`409 {existing_id}`), selections validated against the library indexes (400) |
| PUT `/api/custom-templates/<ct_id>` | Rename and/or re-pick (self-name allowed; rename onto another name → 409) |
| DELETE `/api/custom-templates/<ct_id>` | Remove one saved custom template |

The server binds `127.0.0.1` only and rejects foreign `Host`/`Origin`
headers with 403, matching the other local preview servers.

## Template Market

Enumeration reads the four library indexes only (`templates/{brands,styles,
layouts,decks}/*_index.json`); directories are never scanned for discovery.
The market catalog is cached per index-file mtime. The workspace file route
(`/templates/<kind>/<id>/<path>`) gates every request on "id is a key in that
kind's index", so unregistered paths are unreachable; deck SVG
`../images/*` references resolve through this route. Template ids may be CJK
(registered brands such as 中国电信); ids travel URL-encoded between browser
and server, and `_safe_template_id` still screens the segment shape.

Preview rendering happens client-side: the browser fetches each roster SVG,
substitutes `{{TOKEN}}` placeholders with sample text, and rewrites deck
`../images/` prefixes onto the whitelisted route. Brand and style kinds have
no page prototypes; their previews render the parsed design_spec frontmatter
plus a primary-color swatch.

Layout and deck selections generate in strict mode: the template's
Master/Layout layers are a frozen contract (fixed atom ids/geometry/metadata,
slot ids/types/bounds/bindings, fonts and colors on those layers), and only
slot content — visible text values, slotted images, chart/table data — is
editable. The market header and the layout/deck preview modal state this
disclosure in UI copy.

### Custom templates (我的模板)

A saved custom template is a **combination preset**: `{name, selections[]}`
of plain library `(kind, id)` pairs, stored as one JSON record per
generated `ct…` id under `projects/.workbench/custom_templates/`. Names are
data, never path segments — same discipline as the task registry. The
market UI offers a dual-mode switch (挑成品一步到位 / 自定义组合; a chosen
deck desaturates the other three kinds with an override notice, and the
combination bar lists unselected kinds as AI-decided), a 存为我的模板 flow
with a naming modal plus browser confirms for overwrite and delete, and a
我的模板 tab whose 使用 button is blocked when a saved id has left the
official indexes (the stale ids are listed).

Expansion is deliberately client-side: 使用/编辑 writes the saved pairs back
into the ordinary market selection state, and saving to a task goes through
the same `PATCH /api/tasks/<id>` `template_selection` path — custom templates
never appear in `task.json`. The agent consumption contract (step 4 of the
seven-step runbook below) is therefore unchanged.

## Task File Bus

One directory per task under `projects/.workbench/tasks/<task_id>/`:
`task.json` (the record), `uploads/` (raw staged material), and
`feedback.json` (post-delivery feedback, written by the browser, read by
the agent on revision requests). Task ids are generated ASCII
(`t<YYYYMMDD>-<HHMMSS>-<4 hex>`); user text lives only in JSON values, so
Chinese titles never become path segments.

### Lifecycle

```
draft ──submit(server)──> submitted ──claim(agent)──> processing ──agent──> done
   │                            │                          │
   └─(editable/uploads)         └──────────────────────────┴──> failed (with error)
```

- `draft` is fully editable (PATCH, uploads, template selection); `submit`
  validates and freezes the user domain once.
- Exactly one agent run per task: the agent claims a `submitted` task by
  writing `status: "processing"` (atomic write); any other agent seeing a
  non-`submitted` status skips it.
- v1 has no reopen for `failed`; the user asks the agent to repair in chat
  or creates a new task.

### Writer boundaries

| Field group | draft | after submit | Writer |
|---|---|---|---|
| `display_title`, `topic`, `requirements`, `params`, `template_selection`, `uploads` | server (PATCH/POST/DELETE) | frozen (server returns 409) | server |
| `status`, `submitted_at`, `updated_at` | server: draft→submitted | agent: submitted→processing→done/failed | per phase |
| `project_dir`, `started_at`, `finished_at`, `error`, `deliverables`, `agent_log` | absent/null | agent only (server never writes) | agent |

Both writers use temporary-file + `os.replace` atomic writes. The server
re-reads `task.json` from disk on every request, so agent write-backs are
visible without restart.

### task.json v1 schema

```jsonc
{
  "schema_version": 1,
  "task_id": "t20261015-143022-a1b2",
  "status": "draft",               // draft|submitted|processing|done|failed
  "created_at": "2026-10-15T14:30:22",
  "submitted_at": null,
  "updated_at": "…",

  // ---- user domain (frozen at submit) ----
  "display_title": "Q3 汇报",
  "topic": "非空任务主题",
  "requirements": {"audience": "", "tone": "", "extra": ""},
  "params": {
    "profile": "quick",            // quick|default
    "canvas": "ppt169",            // config.CANVAS_FORMATS key
    "page_count": null,            // hint, not a hard constraint
    "primary_language": "zh-CN",
    "speaker_notes": false,
    "image_policy": "auto"         // auto|none|web|ai (hint)
  },
  "template_selection": {          // vocabulary aligned with confirm_ui template_selection v1; no hash chain
    "mode": "free_design",         // free_design|templates
    "selections": [                // at most one per kind; mode=templates requires ≥1
      {"source": "library", "kind": "deck", "id": "…", "workspace_root": "…"}
    ],
    "indexes_sha256": {"brand": "…", "style": "…", "layout": "…", "deck": "…"},
    "selected_at": "…"
  },
  "uploads": [{"name": "需求文档.docx", "size": 12345}],   // snapshot taken at submit

  // ---- agent domain (written after submit) ----
  "project_dir": null,
  "started_at": null,
  "finished_at": null,
  "error": null,
  "deliverables": [],
  "agent_log": [{"at": "…", "event": "project initialized"}]
}
```

The browser submits template selections as `(kind, id)` pairs only; the
server resolves each `workspace_root` from the registered library indexes,
so an arbitrary path can never enter a task. `indexes_sha256` fingerprints
the four index files at selection time so the agent can warn (never block)
when the template library changed after the user chose. Unlike the Confirm
UI there is no receipt hash chain: the user domain freezes once at submit
and the agent cannot rewrite it, so stale-receipt binding is structurally
unnecessary.

`feedback.json`: `{schema_version: 1, rating: 1-5|null, comment,
wants_revision, submitted_at}` — written by the browser at any status; the
agent reads it when the user asks for a revision.

## Agent Consumption Contract

The routing row in `workflows/routing.md` points here. When the user asks to
process a workbench task, the agent runs this playbook inside the profile the
task's `params.profile` selects (`quick` → Quick runtime, `default` → Default
runtime with its normal Confirm UI stages).

1. **Claim**: read `projects/.workbench/tasks/<task_id>/task.json`. Proceed
   only when `status == "submitted"` and `schema_version == 1`; any other
   status means the task is already claimed, finished, or still a draft —
   say so and stop. Write back `status: "processing"`, `started_at`, and
   `project_dir` (atomic temp-file + `os.replace`, same as the server).
2. **Initialize**: `project_manager.py init <slug> [--format <canvas>]`
   with a slug derived from `display_title`/`topic` (ASCII-safe, dated by
   the tool itself); pass `--format` only when `params.canvas` names a
   registered canvas key, and `--quick-generate` when the profile is
   `quick`. Record the resulting absolute project path in `project_dir`.
3. **Material**: `project_manager.py import-sources <project> <task>/uploads/*`
   when uploads exist — its move semantics carry the staged files into
   `sources/`; conversion and any research then follow the selected
   profile's normal source-intake rules.
4. **Templates**: when `template_selection.mode == "templates"`, feed each
   `selections[].workspace_root` into the existing explicit-workspace-root
   rule of the selected profile (Quick: validate and install directly;
   Default: Stage-1 candidate with the single-root preselection). If
   `indexes_sha256` no longer matches the current index files, warn the
   user that the library changed since the selection, then continue —
   `apply_template.py` remains the final validator. `free_design` mode
   skips all of this.
5. **User domain is explicit**: `topic`, `requirements`, and `params`
   (language, page count, canvas, image policy, speaker notes) are the
   user's stated requirements for this run — honor them as explicit
   requests in the profile's normal confirmation/spec mechanics; they are
   hints the profile reconciles with its own gates, not replacements for
   them.
6. **Write back milestones**: append `{at, event}` entries to `agent_log`
   at meaningful checkpoints (project initialized, templates installed,
   each authored page batch, quality gates, export). On success write
   `status: "done"`, `finished_at`, and `deliverables` (the export file
   names); on failure write `status: "failed"` and a human-readable
   `error`. Every write is atomic, and the agent never edits the frozen
   user domain.
7. **Feedback**: when the user asks for a revision, read `feedback.json`
   (`wants_revision`, `comment`) alongside the task record.

## Progress View

The progress endpoint is pure derivation over the project tree the agent
pointed at (`task.json.project_dir`); the workbench never writes into a
project. Slides are recognized by the numeric-prefix naming contract
(`P01.svg`, `01_cover.svg`), exports by the `.pptx` suffix, and the confirm
panel state comes from the project's `confirm_ui/session.json` when a
Default-profile task runs one. The browser polls every 2 s while the task
is open and stops once the status is `done` or `failed`, then offers the
feedback card.

## Frontend regression checks

Manual checklist, run on a disposable checkout:

1. `uv run python scripts/workbench/server.py` opens the browser at the logged URL.
2. The task list renders; creating a task from a topic jumps to its detail page.
3. The detail form edits params, uploads a file, and the file appears in the list.
4. The template market lists all four kinds; a layout preview renders its roster
   pages with sample token text; the 中国电信 deck preview shows its images.
   The market header and layout/deck preview state the strict-mode frozen-
   contract disclosure (only slot content is editable).
5. Selecting one template per kind, saving, and submitting shows the copyable
   agent hint; afterwards the page is a read-only summary.
6. Market v2: the mode switch renders; choosing a deck dims the other kinds
   with the override notice; 自定义组合 shows the unselected-kinds summary;
   存为我的模板 → naming modal → card appears under 我的模板; overwrite-save
   and delete each ask a browser confirm; a record with a hand-removed id
   lists 失效 and blocks 使用.
7. With a hand-attached fake project (task.json `project_dir` plus a few
   svg_output/*.svg and one exports/*.pptx), the progress page renders page
   thumbnails, lists the export with a download link, and stars/rating
   feedback lands in feedback.json.
8. `curl -H "Host: evil.example" http://127.0.0.1:<port>/api/health` returns 403.
9. `uv run python scripts/workbench/server.py --shutdown` returns 0 twice in a row.

## Remote access

Run with `--no-browser` and forward the port over SSH; the server binds
loopback only, so the tunnel endpoint is the sole exposure.
