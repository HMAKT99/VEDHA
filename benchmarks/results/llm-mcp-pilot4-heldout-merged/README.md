Pilot 4 (held-out widgets, MCP vs MCP, one free model, 2 trials per cell, 24-turn cap) with the 9 trial pairs that ended in `driver_error` (network outage window, trial timeouts) replaced by a re-run (`rerun-trials.jsonl`, rows marked `rerun`). Both runs used the build at a98e5ca, which predates adaptive polling, write-based mutating inference and fail-fast waiting.

| arm | effect scenarios completed (n=20) | defect scenarios: false pass / flagged (n=14) | median prompt tokens |
|---|---|---|---|
| Playwright MCP | 18 | 6 missed / 8 uncertain | 75,223 |
| Vedha MCP | 13 (7 ended "uncertain" although the effect happened) | 7 missed / 1 detected + 6 uncertain | 49,964 (-34%) |

Vedha used fewer tokens but completed fewer tasks and did not reduce false passes in this pilot. Small N, one model, harness errors now 0.
