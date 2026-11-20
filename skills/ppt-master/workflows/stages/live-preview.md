---
description: Main-pipeline editor stage for starting live preview and applying submitted annotations.
---

# Live Preview Stage

> (1) Point the user at the workbench's preview surface (`/p/<slug>/preview/`); (2) apply user-submitted annotations after Step 7 export. Executor's mandatory preview step lives in [`generate-pptx`](../generate-pptx.md) Step 6 — the workbench is resident, so there is nothing to launch or re-launch. Editor behavior is documented in [`svg_editor.md`](../../scripts/docs/svg_editor.md).

## When to Run

- **Step 1** — the user wants to look at the deck or click an element after export (post-export re-entry in a fresh chat, or the user closed the preview tab earlier).
- **Step 2** — Step 7 has produced at least one PPTX and the user signals that annotations should be applied: quoting the browser prompt (`Changes saved to svg_output...` or its localized equivalent) or asking, in any language, to apply the staged annotations (e.g. `apply my annotations`).

**When not to run**: the tab is already open → give the URL; a precise chat edit ("change page 3 title to X") → edit the SVG directly; a full regeneration → main workflow; Step 7 has never run → finish the main pipeline first.

---

## Step 1: Open the preview surface

Tell the user, in their language, the workbench URL for this project's preview tab (`/p/<slug>/preview/`). The workbench must be running; if it is not, say so and start it once (`workbench/server.py --daemon`). Report the URL the workbench printed, never an inferred port. Then tell the user, in their language, in one short message:

- the editor URL;
- **Direct edit** for deterministic tweaks (wording, color, coordinates, attributes): select an element → change the right-panel controls → preview updates immediately, nothing is written until **Apply changes**; `Ctrl+Z` / **Undo** drops staged edits; re-export stays chat-driven ("re-export" / "重新导出");
- **Annotate** for changes needing AI judgement or re-layout: select an element → write the instruction (optionally from a quick type such as move / resize / replace image / copy / relayout) → **Add annotation** → **Apply changes** → return to chat and say `apply my annotations`;
- to skip the editor, describe the change in chat.

---

## Step 2: Apply submitted annotations

🚧 **GATE**: `<project_path>/exports/` contains at least one `*.pptx`; otherwise tell the user to finish the main pipeline first.

1. `python3 ${SKILL_DIR}/scripts/check_annotations.py <project_path>` — its output lists each pending change as `file → element_id → annotation text → content preview`; use it directly as the to-do list. If it reports none, tell the user and stop.
2. For each annotation: edit the targeted element in `<project_path>/svg_output/<file>` per the text; remove `data-edit-target` and `data-edit-annotation` from it; append one `annotation_applied` JSONL record (`ts`, `file`, `element_id`, original text) to `<project_path>/live_preview/annotations.jsonl`.
3. Re-enter [`generate-pptx`](../generate-pptx.md) Step 7.2, wait for its success criterion, then run Step 7.3; rerun Step 7.1 only when speaker notes changed.
4. Tell the user, in their language: annotations applied, new PPTX exported, preview still running (refresh or reselect the page if the browser shows the old slide).
5. More annotations → repeat from 1; "done" or "stop preview" → end.
