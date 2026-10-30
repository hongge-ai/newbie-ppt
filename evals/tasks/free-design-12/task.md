# free-design-12

The baseline exam: one fixed source deck, free design, a page-range target.

## Request handed to the run

> Read `inputs/product-brief.md` and build a deck that explains the product to a
> technical evaluator. Free design — no template. Aim for **10–14 pages**; the
> range is the target, not a fixed count.
>
> Work from the repository's normal Generate route: Strategist, then Executor,
> then the standard gates. Do not skip the first-page probe.

## Why this task

It is the scenario every prompt change is measured against, so it must stay
stable. The page range rather than a fixed 12 exists so a run can legitimately
compress or expand the argument; the exam tests the deck, not the count.

## Freezing

Every file under `inputs/` is part of the exam. Changing one invalidates every
recorded baseline for this task — record the change in the commit message and
re-record.

## Scoring

`expect.json` holds the pass conditions: zero blocking findings, zero pages
with errors at the final gate, and a page count inside the range. The verdict
is pass/fail per condition, plus the raw numbers so two passing runs can still
be compared on cost.
