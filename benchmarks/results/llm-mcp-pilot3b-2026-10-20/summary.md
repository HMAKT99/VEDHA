# LLM run summary: llm-mcp-pilot3b-2026-10-20

| arm | completion (healthy) | false-pass | detected with submit (defects) | uncertain | median tokens/trial | errors |
| --- | --- | --- | --- | --- | --- | --- |
| mcp-playwright | 11/12 (92%, CI 65-99%) | 0/16 (0%, CI 0-19%) | 0/4 (0%, CI 0-49%) | 5/16 (31%, CI 14-56%) | 82468 | 0 |
| mcp-vedha | 11/12 (92%, CI 65-99%) | 0/16 (0%, CI 0-19%) | 0/4 (0%, CI 0-49%) | 5/16 (31%, CI 14-56%) | 67640 | 0 |

## Per scenario

| scenario | mcp-playwright | mcp-vedha |
| --- | --- | --- |
| S01-order-clean | success, success | success, success |
| S02-order-slow-ui | success, success | success, success |
| S03-order-cookie-banner | success, success | success, success |
| S04-order-renamed-button | success, success | success, success |
| S06-defect-silent-500 | uncertain_defect, uncertain_defect | uncertain_defect, uncertain_defect |
| S07-defect-wrong-quantity | uncertain_defect, uncertain_defect | uncertain_defect, uncertain_defect |
| S09-transient-503 | uncertain_effect_done, success | uncertain_no_effect, success |
| S10-commit-then-late-response | success, success | success, success |

## Pre-registered decision rule

- mcp-vedha vs mcp-playwright: completion not lower (within 5 points): **yes**; false-pass lower with non-overlapping CIs: **no** (0/16 (0%, CI 0-19%) vs 0/16 (0%, CI 0-19%)); per-cell N is small (12 healthy trials), so a "better" verdict is only an indication.
