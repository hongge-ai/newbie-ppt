# Baselines

One file per task and model: `<task-id>.<model>.json`. A baseline is what the
next prompt change is compared against, so it records enough context to explain
a later difference, not just the score.

## Fields

| Field | Why it is here |
|---|---|
| `task` | Which exam; must match the directory name under `tasks/` |
| `model` | The model id reported by the run environment |
| `recorded_at` | ISO date of the recording, for attributing a shift to the provider rather than the prompt |
| `settings` | The fixed settings the trial pinned, so a later run can be made comparable |
| `runs` | One entry per trial: verdict, numbers, wall clock, artifacts |
| `summary` | Pass count, and the spread that matters (pages, blocking, wall) |
| `notes` | Anything that limits what the numbers mean |

## What is deliberately absent

- **Sampling parameters.** The pipeline does not set them; the provider default
  is the setting, and recording a value nobody set would be fiction.
- **An expected deck.** The task stores inputs and conditions only.
- **A pass threshold on cost.** Steps and wall clock explain *why* two passing
  runs differ; they never decide pass/fail.

## Recording

```bash
python3 skills/ppt-master/scripts/eval_score.py evals/tasks/<task-id> <project> --json
```

Copy the verdict into `runs[]`, add the wall clock, and write the file. Re-record
when a run legitimately changes the achievable score, and say why in the commit
message.
