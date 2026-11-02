# Agent Bridge — Runtime Status, Event Log, and Request Inbox

> One agent-agnostic protocol for "where is this project now" and "the user must
> answer something". Any agent that can run a shell command writes it; any web
> surface reads the same files. The bridge never runs generation and never calls
> a model.

## Authority and Scope

| Concern | Owner |
|---|---|
| Runtime file layout, schema, and write rules | This document |
| The `agent_bridge.py` command surface and exit codes | This document |
| When a workflow emits each event | The route that runs it ([`generate-pptx.md`](../../workflows/generate-pptx.md) etc.) |
| Server launch, port, and lock behavior for the web surface | [`workbench.md`](workbench.md) |

**Hard rule**: `events.jsonl` is the source of truth. `status.json` is a
projection of it and is never hand-edited. Removing `.runtime/` loses run
history only; no deck artifact depends on it.

## Why the split exists

Generation runs in an external agent, so two parties could write state: the
agent (it knows which stage it is in) and any viewer (it can count pages).
Only the first is real information.

| Kind | Examples | Writer | Stored where |
|---|---|---|---|
| Decision facts | current stage, what the user must do next, what blocked the run | `agent_bridge.py` only | `.runtime/status.json` + `events.jsonl` |
| Derivable quantities | page count, export presence, checker result, whether a service is up | nobody writes them; readers compute | the project tree itself |

Consequences: `status.json` can be stale but can never contradict. Staleness is
detected by the lease, not by a second writer.

## Layout

```
<project>/.runtime/
├─ status.json          materialized view (rebuildable)
├─ events.jsonl         active event shard (append-only)
├─ events.<first>-<last>.jsonl   rotated shards, seq keeps increasing
├─ lease.json           writer lease, monotonic fence
├─ write.lock/          mkdir-based lock directory (+ owner.json)
└─ inbox/
   ├─ req-NNNN.json     agent asks
   └─ resp-NNNN.json    one immutable answer per request
```

The directory is deliberately outside `validation/`: it is runtime state, not
an artifact. `validate` treats it as optional and checks the schema only when
it exists.

## `status.json`

```jsonc
{
  "schema_version": 1,
  "project": "demo_ppt169_20261031",
  "task_id": "t20261031-091400-7f3a",
  "run": { "run_id": "r-20261101T091233Z-7f3a", "fence": 3, "started_at": "..." },
  "route": "generate",
  "profile": "default",
  "stage": "execute",
  "stage_index": 9,
  "stage_label": "绘制页面 7/12",
  "state": "running",
  "surface": "web",
  "progress": { "done": 7, "total": 12, "unit": "page" },
  "next_action": null,
  "blocking": { "req_id": "0007", "kind": "confirm", "prompt": "..." },
  "error": null,
  "heartbeat_at": "...",
  "lease_expires_at": "...",
  "updated_at": "...",
  "source_seq": 142,
  "version": 142
}
```

| Field | Derived from |
|---|---|
| `stage`, `stage_index`, `stage_label` | the last `stage/enter` |
| `task_id` | the last `run/start` carrying `--task`; `null` when the run answers no workbench task |
| `state` | an unanswered request → `waiting_user`; an expired lease → `interrupted`; otherwise the last `run/*` or `error` |
| `progress` | the last `progress` event, or `null` — never `0/0` |
| `blocking` | the last `ask/open` without a matching answer |
| `version` | the folded `source_seq`; monotonic, used by viewers for deduplication |

`state` values: `idle` (no run yet), `running`, `waiting_user`, `interrupted`,
`failed`, `done`.

**`interrupted` is never written.** The projection applies it at read time from
the lease, so a viewer that opens the page after the agent died sees the truth
without any process having to notice.

## `events.jsonl`

One JSON object per line, `\n`-terminated, at most 4000 bytes per line. Longer
content belongs in a project file referenced by path.

```jsonc
{"v":1,"seq":142,"at":"...","run_id":"r-...","fence":3,"type":"progress",
 "data":{"done":7,"total":12,"unit":"page"}}
```

| `type` | Emitted by | `data` |
|---|---|---|
| `run/start` | `run start` | `route`, `profile`, `surface`, `resume`, `task` |
| `run/heartbeat` | `beat`, `run wrap`, `wait` | — |
| `run/end` | `run end` | `outcome`: `done` \| `failed` \| `aborted` |
| `stage/enter` | `stage` | `stage`, `index`, `label` |
| `stage/exit` | `stage` (on change) | `stage`, `outcome` |
| `progress` | `progress` | `done`, `total`, `unit` |
| `ask/open` | `ask` | `req_id`, `kind`, `prompt` |
| `ask/answered` | `answer` | `req_id`, `status`, `choice`, `by` |
| `ask/superseded` | `run start --takeover` | `req_id`, `by` |
| `say` | `say` | `level`, `text` |
| `error` | `fail` | `code`, `message`, `recover` |
| `takeover` | `run start --takeover` | `prev_run_id`, `prev_fence`, `reason` |
| `service/up`, `service/down` | reserved | `name`, `port`, `pid` |

Rules:

- `seq` is global and monotonic, allocated under the runtime lock. Events never
  sort by timestamp; clocks across processes are not comparable.
- One `write()` per line. A reader that finds a final line without `\n` treats
  it as a torn write and ignores it — the only permitted corruption.
- Rotation moves the active shard to `events.<first>-<last>.jsonl` at 8 MiB and
  keeps the newest 20 shards. `seq` stays continuous across shards.
- Only one fence is authoritative. A takeover bumps `fence`; events carrying an
  older fence are ignored by the projection, so an abandoned agent that wakes
  up cannot move the state backwards.

## Inbox

A request is created exclusively and never modified. The answer is created
exclusively and never overwritten; a second attempt is a conflict, not an edit.

```jsonc
// req-0007.json
{
  "schema_version": 1, "id": "0007", "opened_seq": 141,
  "run_id": "r-...", "fence": 3,
  "kind": "confirm",                          // confirm|choice|text|approval|edit
  "title": "Stage 1 通信契约",
  "body": "…markdown…",
  "options": [{"id": "free_design", "label": "自由设计", "detail": "不套模板"}],
  "multi": false, "allow_text": true,
  "url": "http://127.0.0.1:7070/#/task/t20261031-091400-7f3a",
  "deadline": null, "default_if_timeout": null,
  "attachments": []
}
```

```jsonc
// resp-0007.json
{
  "schema_version": 1, "id": "0007", "req_seq": 141, "at": "...",
  "status": "answered",                       // answered|declined|expired|superseded
  "by": "user",                               // user|timeout|takeover|cli
  "choice": ["free_design"], "text": null,
  "answered_by_surface": "web"                // web|chat|cli
}
```

Protocol allows several open requests; the workflow discipline opens one at a
time. A waiter polls `resp-NNNN.json`; it needs no long-lived connection.

**Timeout is not failure.** `wait` exits `2` with the request still open, so an
agent may hand back to chat and a user who answers later is still believed.
The agent then calls `wait` again, or reads the answer at its next checkpoint.

## Lease and recovery

```jsonc
// lease.json
{
  "run_id": "r-...", "fence": 3, "pid": 4816, "host": "DESKTOP-XXXX",
  "acquired_at": "...", "heartbeat_at": "...", "expires_at": "...",
  "ttl_seconds": 60
}
```

Every mutating command is its own short-lived process, so the lease answers one
question: is a run open and recent enough to accept writes? It is refreshed by
`beat`, by `run wrap` every 20 s, and by `wait` while it polls.

| Symptom | Handled by | Behaviour |
|---|---|---|
| agent killed without `run end` | any reader | lease expires → `state: interrupted`; no event is written |
| write from the abandoned run after takeover | projection | ignored (older fence) |
| half-written final event line | any reader | ignored |
| process died between `mkdir` and owner write | next writer | directory age reclaims it |
| process died holding the lock | next writer | dead pid on this host reclaims it |
| user never answers | viewer | stays `waiting_user`; `deadline` + `default_if_timeout` answer as `by: timeout` |
| different machine / different agent | `run start --takeover` | fence +1, open requests superseded |

Recovery commands:

```bash
agent_bridge.py run start --resume     # same run id and fence; refreshes the lease
agent_bridge.py run start --takeover   # new run id, fence + 1, supersedes open requests
```

Takeover writes a `superseded` response file for every open request, because a
response file is what releases a waiter; a log event alone would leave it
polling forever.

## Commands

```bash
agent_bridge.py run start [--route generate] [--profile default] [--surface chat|web]
                          [--resume | --takeover [--reason expired|manual|host-change]]
                          [--task <task_id>]
agent_bridge.py run end   [--outcome done|failed|aborted]
agent_bridge.py run wrap  -- [--project DIR] <command ...>
agent_bridge.py stage     <stage> [--label "绘制页面 7/12"]
agent_bridge.py progress  <done> [--total <n>] [--unit page]
agent_bridge.py beat
agent_bridge.py ask       --kind <kind> --title <title> [--body-file <f>]
                          [--options-json <f>] [--multi] [--no-text] [--url <u>]
                          [--wait --timeout <s>]
agent_bridge.py wait      <req_id> [--timeout <s>]
agent_bridge.py answer    <req_id> [--status answered|declined] [--choice <id>]...
                          [--text <t>] [--surface web|chat|cli]
agent_bridge.py say       <text> [--level info|warn]
agent_bridge.py fail      --code <c> --message <m> [--recover <anchor>]
agent_bridge.py show      [--json]
agent_bridge.py rebuild
```

Every command except `run` accepts `--project DIR` (default: current directory).

| Exit | Meaning | Agent should |
|---|---|---|
| `0` | done | continue |
| `1` | usage error | fix the command |
| `2` | wait timed out, request still open | hand back to chat, or `wait` again later |
| `3` | lease held or expired | `run start --resume` or `--takeover` |
| `4` | already answered / lock conflict | read the existing answer; never re-ask |
| `5` | corrupt runtime state | run `rebuild` |

## Stage tables

Order is the contract: readers compute remaining work from the index
difference, and a stage may never be re-entered earlier.

| Route | Stages |
|---|---|
| `generate` | `init → source → template_prep → confirm_stage1 → template_install → spec → spec_review → lock → images → execute → finalize → export → done` |
| `create-template` | `init → intake → brief → confirm → child_run → assets → review_pptx → register → done` |
| `edit-native` | `import → plan → confirm → edit → notes_motion → export → done` |

`spec_review` appears only when `refine_spec` is set; skipped conditional
stages are not written at all rather than written as `null`.

## Where the workflow calls it

Write points live in the route file beside the existing `validate` call, not
inside helper scripts: a checker does not know which workflow step invoked it.
The single exception is `run wrap`, which lets a long checker keep the lease
alive without the checker importing anything.

Generate route:

| Point | Call |
|---|---|
| Processing a submitted workbench task | `run start --route generate --task <task_id>` (the only task binding; inherited by `--resume` and `--takeover`) |
| `project_manager.py init` succeeded | `run start --route generate --profile <p>` |
| Step 1 conversion complete | `stage source` |
| Step 2 validation passes | `stage template_prep` |
| Step 3 candidates ready, Stage 1 launch | `stage confirm_stage1` + `ask --kind confirm` |
| Stage 1 receipt read | `answer` is written by the surface; agent calls `stage template_install` then `stage spec` |
| Stage 2 launch | `ask --kind confirm --title "Stage 2 …"` |
| Design Spec authored | `stage spec_review` when `refine_spec`, else `stage lock` |
| lock validated | `stage images` (skip when no image rows) |
| first page begins | `stage execute` + `progress 0 --total <§IX count>` |
| each page, or each early-gate anchor | `progress <n>` |
| Step 7 begins | `stage finalize` |
| export command issued | `stage export` |
| export exits 0 | `stage done` + `run end --outcome done` |

Tests: [`tests/test_agent_bridge.py`](../tests/test_agent_bridge.py).
