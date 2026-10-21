Pilot 5: the same held-out widget pilot as pilot 4 (MCP vs MCP, one free model, 2 trials per cell, 24-turn cap) on the build with adaptive polling, write-based mutating inference and fail-fast waiting (commit 3a169de). Transcripts are not committed (large).

Valid cells: the 20 effect scenarios per arm (0 harness errors). INVALID cells: 13 of the 28 defect trial-arms ended in `driver_error` (12 "trial timeout" with wall times of 15-35 minutes against a 10-minute limit, which points to the machine being suspended or stalled overnight, and 2 "fetch failed"), far over the 5% rule, so defect-scenario results here are not reported as a comparison.

| arm | effect scenarios completed (n=20) | ended "uncertain" though the effect happened | median prompt tokens |
|---|---|---|---|
| Playwright MCP | 19 | 1 | 75,715 |
| Vedha MCP | 11 | 9 | 64,131 (-15%) |

Vedha completed fewer effect tasks than Playwright MCP again (pilot 4: 13 vs 18). In the transcripts read, the model kept probing for server-side state after the UI already showed success (e.g. W07: status "Deleted", then fetching /api/items, hitting 404 pages) and then ended with no RESULT line, which the harness scores "uncertain". Token saving shrank from -34% to -15%. One free model, N=2 per cell: this does not show that Vedha completes tasks as well as Playwright MCP.
