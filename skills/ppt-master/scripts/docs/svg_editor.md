# `svg_editor/server.py`

Browser SVG editor behind the [`live-preview`](../../workflows/stages/live-preview.md) stage and Generate Step 6. It is a surface of the resident workbench, served at `http://127.0.0.1:<workbench port>/p/<project slug>/preview/`; this page documents editor behavior, and the stage owns when to open it and how to apply annotations.

## Where it runs

Nothing is launched and nothing is shut down: the workbench already owns the process. Open the URL above (the workbench task page has a 页面预览 tab for it) and keep the tab open through Step 7. Mounted mode disables the idle watchdog and turns `/api/shutdown` into a no-op, so closing the view never ends the shared process.

## Behavior

- **Edits land in place**: the editor stages direct edits and annotations in memory, and **Apply changes** writes `<project_path>/svg_output/` only.
- **Transient ids**: each element gets a temporary `_edit_N` id while running; on save only annotated elements keep their id.
- **Browser preview**: the server inlines `<use data-icon>` placeholders and serves `images/*`; the on-disk SVG is unchanged by preview.
- **Re-export is chat-driven**: applying changes updates `svg_output/` only; refreshing the PPTX (`finalize_svg.py` + `svg_to_pptx.py`) is a chat step — the editor never runs the export pipeline.

## Editing surface

- **UI**: four languages (中文 / 繁體中文 / English / 日本語), auto-detected from `navigator.language`, persisted in `localStorage`, switchable from the right panel. The right panel separates direct SVG edits from AI-needed annotations, with a pending-status strip for staged edits and pages with unsaved annotations. Slide navigation: first/prev/next/last buttons plus `←` / `→` / `Home` / `End` (suppressed while typing in the annotation textarea).
- **Buttons**: `Add annotation` stages annotation text in memory; `Apply changes` writes staged direct edits plus annotation markers (`data-edit-target`, `data-edit-annotation`) to disk and keeps the service running; `Exit preview` stops Flask.
- **Direct edit (no AI)**: single element = full inspector (geometry, safe text content, computed text styles for the selected text node or descendant text, raw attributes except protected fields such as `id`, UI `class`, event handlers, hrefs). `<g>` group = group-level surface, selected via `Alt/Option` + click or **Select parent group**. Multi-select = batch editor over top-level objects only: shared x/y plus `fill` / `stroke` / `opacity`; text style fields appear only when every selected object is `text` / `tspan`. Preview updates immediately; disk writes wait for **Apply changes**.
- **Drag to move**: press and drag an already-selected element (selection stays a separate click, so the background is never dragged by accident); the whole selection moves together. Pointer delta is mapped through each element's CTM, so moves track the cursor regardless of viewport scale or group transforms. Each release stages one direct edit per moved element; dragging on empty canvas is rubber-band selection; a failed stage rolls the canvas back.
- **Arrow-key nudge**: `↑ ↓ ← →` moves the selection 1px, `Shift + arrow` 10px (suppressed while typing); arrow keys navigate slides only when nothing is selected. Same staging/coalescing as drag.
- **Overlap picker**: right-click lists every selectable element under the pointer (top→bottom); hovering highlights, clicking selects, `Esc` or an outside click closes; with one element under the pointer, right-click selects it directly. Left-click selects the topmost.
- **Undo**: `Ctrl+Z` or **Undo** drops the last staged direct edit on the current slide (per-slide LIFO, this session). Consecutive edits to the same element and field set coalesce into one step keeping the original pre-edit value. Applied old→new history goes to `live_preview/edits.jsonl`; annotation save/update/remove history to `live_preview/annotations.jsonl`; un-applied staged edits are memory only.
- **Unsaved-work guard**: staged edits and annotation changes live in server memory until **Apply changes**; closing the tab triggers the browser's "leave site?" prompt while any are unapplied.

## Remote access

On a remote Linux host, forward the workbench port from `projects/.workbench/workbench.lock`: VS Code / Cursor Remote-SSH — forward `<P>` in the **PORTS** panel; Termius — a Local rule with Binding and Destination both `127.0.0.1:<P>`; plain SSH — `ssh -L <P>:127.0.0.1:<P> <user>@<host>`. Then open `http://localhost:<P>/p/<slug>/preview/`.
