# Evals

Fixed-input exams for the generation prompt. A prompt change is judged by the
same exam before and after, not by reading the diff.

The loop is **change → run → compare → decide**. `prompt_audit.py` proves the
corpus did not grow; it cannot prove the model still follows it. These exams
are the part that can.

## Shape

```
evals/
  baselines/            recorded scores, one JSON per task and model
  tasks/
    <task-id>/
      task.md           the request handed to the generation run
      inputs/           fixed source material; byte-identical across runs
      expect.json       pass conditions and the page range
```

A task stores **inputs and pass conditions**, never an expected deck. A strong
model can reach a passing deck by a different route, so the grader reads
behaviour, not a reference answer.

## Running one

Model runs stay manual and out of CI: they cost tokens, take minutes, and are
non-deterministic. Score a finished project with:

```bash
python3 skills/ppt-master/scripts/eval_score.py evals/tasks/<task-id> <project_path>
```

The command runs the checker against the project, applies `expect.json`, prints
a JSON verdict, and exits non-zero when the task fails.

With `require_export` set, a clean checker report is not enough: the task also
requires a deck under `exports/` whose slide count equals the authored page
count. A run that stops before Step 7 has not delivered, and the scorer says so.

## What counts as evidence

| Layer | Signal | Cost |
|---|---|---|
| Pass/fail | `blocking` findings, failed pages, page count | free, deterministic |
| Cost | `run_report.py` steps, wall clock, reads | free, from the transcript |
| Craft | a human looks at 2–3 pages | minutes |

Only the first layer is a gate. The second explains *why* two passing runs are
not equal; the third is not automatable and is never claimed as such.

## Controls

`tasks/control-broken-page/` ships a page that must fail. Run it after any
change to the scorer or the checker: a green control means the grader has
stopped grading, and every passing task is meaningless.

## Baselines

`baselines/<task-id>.<model>.json` records the model id, the date, and the
per-run scores. The model id is there for **attribution**: when a score moves,
the baseline says whether the prompt or the provider changed. Sampling
parameters are not recorded because the repository does not set them.

A baseline is a snapshot, not a target. Re-record it when a run legitimately
changes the achievable score, and say why in the commit message.
