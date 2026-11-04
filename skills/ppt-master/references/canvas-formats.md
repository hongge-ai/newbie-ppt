# Canvas Format Specification

> See [`shared-standards-core.md`](./shared-standards-core.md) §4.1 for the normative root `viewBox` grammar, compatibility spellings, and fail-closed validation rules.

This repository authors PPTX decks, so only the two PowerPoint canvases are
registered:

| ID | Format | Size | viewBox | Ratio | Use Case |
|----|--------|------|---------|-------|----------|
| `ppt169` | PPT 16:9 | `1280x720` | `0 0 1280 720` | 16:9 | Modern projectors, online presentations |
| `ppt43` | PPT 4:3 | `1024x768` | `0 0 1024 768` | 4:3 | Traditional projectors |

`config.CANVAS_FORMATS` is the single source of truth; project initialization,
the confirmation page, template indexes, the checker, and the exporter read it.
No other canvas is offered or accepted.

All pages and internal Layout prototypes in one export share one numeric canvas
within PowerPoint's slide range (914,400–51,206,400 EMU per side). A fractional
or custom canvas is accepted only as compatible input for an imported custom
PowerPoint slide size (Edit Native PPTX round-trip); it is never a generation
target.

## Typography Scale Start

**Hard rule — normative owner**: this section owns the initial body-size anchor and sanity band for every registered canvas. Strategist consumes it directly; Confirm UI maintains an exact executable mirror and must not infer alternate canvas classes or values. Values are unitless SVG px.

| Canvas | Reading mode | Advisory body band | Initial body |
|---|---|---:|---:|
| `ppt169` / `ppt43` | `text` | 18–21 | 20 |
| `ppt169` / `ppt43` | `balanced` | 22–25 | 24 |
| `ppt169` / `ppt43` | `presentation` | 28–32 | 32 |

An imported custom canvas derives one effective span from `W x H`:

```text
short = min(W, H); long = max(W, H); span = min(long, 3 * short)
low = round(span * 0.025); start = round(span * 0.029); high = round(span * 0.033)
```

**Default — starting anchor, not a floor (confirmed identity, source fidelity, or viewing conditions may override)**: start from the table or formula, then resolve the role ramp and page density from content and delivery context; the band only flags unusual values and is not a validation gate. Apply the viewing-distance baseline in [`shared-standards-core.md`](./shared-standards-core.md) instead of silently shrinking a recurring role to make content fit.
