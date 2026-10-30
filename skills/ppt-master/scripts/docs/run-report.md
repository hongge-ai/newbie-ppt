# `run_report.py`

Maintainer measurement of one harness session. It reads a session transcript and
reports wall clock, step count, tool mix, which files the model actually read,
optional context growth, and the quality-gate timeline with the page count and
error count of every checker call.

It never runs during generation and writes nothing: the report exists so a
pipeline change can be compared against the previous run instead of argued
about.

## Commands

```bash
python3 skills/ppt-master/scripts/run_report.py --latest
python3 skills/ppt-master/scripts/run_report.py --session <transcript.jsonl> --root .
python3 skills/ppt-master/scripts/run_report.py --session <session.v4.jsonl.zstd> --root .
python3 skills/ppt-master/scripts/run_report.py --latest --json
uv run --with tiktoken python skills/ppt-master/scripts/run_report.py --latest --context
```

`--latest` takes the newest `session.v4.jsonl.zstd` under `~/.dsh/sessions/`,
where the harness stores one directory per session. `--session` accepts that
file or its directory, or any other JSONL transcript in the generic shape below.
A `.zstd` suffix is decompressed; every other file is read as plain JSONL.
`--root` shortens absolute read paths in the output. `--json` emits the same data
as a payload.

## Generic input

The tool does not require one vendor's format. Records are normalized before
they are summarized, so a harness only has to emit one JSON object per line:

| Field | Meaning |
|---|---|
| `type` or `event` | The event name. Canonical names are `tool/call`, `tool/result`, `turn/start`, `step/start`, `session`; snake_case aliases (`tool_call`, `tool_result`, `turn_start`, `step_start`, `session_start`) are mapped automatically |
| `time` or `timestamp` | Epoch milliseconds, epoch seconds, or an ISO-8601 string. A record without one inherits the previous record's time |
| `name` / `tool` | The tool name on a call |
| `arguments` / `input` / `args` | The call arguments, as an object or a JSON string |
| `id` / `call_id` / `tool_call_id` | Correlates a result with its call |
| `text` / `output` / `result` | The result text, when it is not under `data.message.content` |

Tools are classified by behaviour rather than by name: `read` / `Read` /
`read_file` / `view` count as reads, `write` / `edit` / `str_replace_editor` /
`apply_patch` as writes, and `bash` / `sh` / `pwsh` / `shell` — or any call whose
arguments carry a `command` — as shell calls. Only shell calls that invoke
`svg_quality_checker.py` become gate rows, so the report does not depend on a
harness naming its shell tool `pwsh`.

DeepSeek Harness records already carry `type` / `time` / `data` and pass through
unchanged.

## Reading the output

| Field | Meaning |
|---|---|
| `wall` | First to last recorded record, so it includes model latency and tool execution |
| `steps` | Model turns in the session; a page batch with fewer steps usually means fewer repair loops |
| `Reads` | Distinct files opened with `read`, with a count per file. Compare against the load set the route declares |
| `Authored pages` | First write of each `svg_output/*.svg`, as a minute offset |
| `Quality gates` | Every checker call in order, with the stage, how many pages existed at that moment, `failed_pages` (the checker's `With errors:` page count) and `blocking` (its hard-finding count) |

The gate rows are the main signal: a gate that runs when every page already
exists can only find faults deck-wide, while a first-page probe that reports
`pages=1` bounds the blast radius of a contract mistake to one page.

## Context measurement

`--context` reconstructs the accumulated prompt per record and tokenizes it with
the `o200k_base` encoding. `tiktoken` is optional and not a dependency of this
repository; without it the command still reports every other field and marks
context as unavailable. Because it tokenizes the transcript rather than the
provider's usage counters, treat the peak as a close estimate, not an exact
billing figure.
