Pilot 7: Playwright MCP vs Vedha MCP on held-out widget set 3 (W17-W22 plus defect twins), one free model (`minimax/minimax-m3.1-flash`), 3 trials per cell, 24-turn cap, forced final-report turn in both arms. Build: commit 7ea31de (includes the write-settle fix 9c4a54f). The scenarios were written (7ea31de) before any LLM run on them. Transcripts are not committed.

`trials.jsonl` is a MERGE of five invocations of the same harness (first run, then four `--only` resumes) keeping one valid row per scenario/trial/arm. 72 rows, 0 errors. Rows were excluded and re-run when they were invalid for reasons unrelated to either tool:
- 49 trial-arms ran while the Playwright browser builds were missing (`~/Library/Caches` had been cleared; both arms reported "browser not installed" and failed). Detected from the transcripts, browsers reinstalled, re-run.
- 38 trial-arms ended in `driver_error` (32 gateway `fetch failed`, 6 trial timeouts, overnight network loss or sleep). Re-run.
Because trials were re-run in several invocations, trial-to-trial timing is not from one uninterrupted session.

| measure (n=18 per kind per arm) | Playwright MCP | Vedha MCP |
|---|---|---|
| effect completed | 17/18 | 16/18 |
| ended "uncertain" though the effect happened | 1 | 2 |
| median prompt tokens, effect cells | 113,001 | 99,597 (-12%) |
| median prompt tokens, defect cells | 195,295 | 126,061 (-35%) |
| defect twins detected / missed | 10 / 8 | 15 / 3 |
| median wall time, effect / defect cells | 228 s / 326 s | 312 s / 308 s |
| median tool calls, effect / defect | 18 / 24 | 30 / 40 |
| forced final turn, effect + defect | 4 + 11 | 6 + 15 |

Against the criteria stated in the round-4 plan: effect completion within one task (met, 16 vs 17); uncertain-although-effect <= Playwright + 1 (met, 2 vs 1, at the limit); defect false pass <= Playwright (met, 3 vs 8); defect misses <= one third of Playwright's (NOT met: 3 vs 8/3); median tokens >= 20% lower on both effect and defect cells (NOT met on effect cells, -12%); median latency not worse than Playwright (NOT met on effect cells, 312 s vs 228 s; about equal on defect cells); harness errors < 5% (met after re-runs: 0 in the final rows, but 49 + 38 trial-arms had to be re-run).

What this does not show: Vedha uses more tool calls and more wall time than Playwright MCP on healthy tasks, and its effect-cell token saving fell from -46% on set 2 to -12% here. Vedha still misses 3 defects (all W20 search filter, rejected-write twin). One free model, n=3 per cell, merged runs.
