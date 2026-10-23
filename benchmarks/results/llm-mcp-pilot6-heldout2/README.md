Pilot 6, final pre-registered run: Playwright MCP vs Vedha MCP on held-out widget set 2 (W11-W16 plus defect twins), one free model (`minimax/minimax-m3.1-flash`), 3 trials per cell, 24-turn cap, both arms with the forced final-report turn. Build: commit 7a5b51f. Held-out set and harness frozen in cfaaa50 before the round-3 product changes (a81326d). Transcripts are not committed (large).

66 trial-arms. 4 ended in `driver_error` (gateway `fetch failed` / invalid JSON response; 2 per arm: W11 defect t0 for both arms, W15 effect t1 Playwright / t2 Vedha). That is 6% of trials, above the 5% rule, so cells with an error have n=2 and the error trials are excluded below, not counted as misses.

| measure (valid trials) | Playwright MCP | Vedha MCP |
|---|---|---|
| effect completed | 17 / 17 valid (1 error) | 17 / 17 valid (1 error) |
| "uncertain although the effect happened" | 0 | 0 |
| median prompt tokens, effect cells | 75,636 | 41,156 (-46%) |
| defect twins detected / missed (false pass) | 4 / 10 | 10 / 4 |
| median prompt tokens, defect cells | 102,592 | 135,009 (+32%) |
| median wall time, effect cells | 163 s | 156 s |
| median wall time, defect cells | 199 s | 285 s |
| median tool calls, effect / defect | 13 / 19 | 16 / 43 |
| forced final turn used (effect + defect) | 1 + 5 | 2 + 10 |

Pre-registered criteria: effect completion within one task (met, tie), uncertain-although-effect <= Playwright + 1 (met), effect tokens >= 20% lower (met), defect false pass <= Playwright (met), harness error rate < 5% (NOT met: 6%).

What this does not show: Vedha is slower and costlier on defect cells (the model keeps probing and re-observing), and still missed 4 defects. Three of the four are W16 (Escape key, silent server bug): Vedha returned `result: verified` for the declared UI check although the write read-back showed nothing stored. One free model, n=3 per cell.

Dev cells W01-W10 (`llm-mcp-pilot6-dev1`) are NOT hold-out: the product changes were tuned against their pilot-5 transcripts. That run covered the Vedha arm only (n=2): 20/20 effect cells completed, 11 defects detected, 2 missed (both model errors against correct evidence).
