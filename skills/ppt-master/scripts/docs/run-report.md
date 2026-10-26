# `run_report.py`

Maintainer measurement of one harness session. It reads a DeepSeek Harness
transcript and reports wall clock, step count, tool mix, which files the model
actually read, optional context growth, and the quality-gate timeline with the
page count and error count of every checker call.

It never runs during generation and writes nothing: the report exists so a
pipeline change can be compared against the previous run instead of argued
about.

## Commands

```bash
python3 skills/ppt-master/scripts/run_report.py --latest
python3 skills/ppt-master/scripts/run_report.py --session <session.v4.jsonl.zstd> --root .
python3 skills/ppt-master/scripts/run_report.py --latest --json
uv run --with tiktoken python skills/ppt-master/scripts/run_report.py --latest --context
```

`--latest` takes the newest `session.v4.jsonl.zstd` under `~/.dsh/sessions/`,
where the harness stores one directory per session. `--session` accepts that
file or its directory. `--root` shortens absolute read paths in the output.
`--json` emits the same data as a payload.

## Reading the output

| Field | Meaning |
|---|---|
| `wall` | First to last recorded record, so it includes model latency and tool execution |
| `steps` | Model turns in the session; a page batch with fewer steps usually means fewer repair loops |
| `Reads` | Distinct files opened with `read`, with a count per file. Compare against the load set the route declares |
| `Authored pages` | First write of each `svg_output/*.svg`, as a minute offset |
| `Quality gates` | Every checker call in order, with the stage, how many pages existed at that moment, and the `With errors:` count it returned |

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
