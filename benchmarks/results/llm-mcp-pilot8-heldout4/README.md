Pilot 8, final pre-registered run: Playwright MCP vs Vedha MCP on held-out widget set 4 (W23-W28 plus defect twins), one free model (`minimax/minimax-m3.1-flash`), 3 trials per cell, 24-turn cap, both arms with the forced final-report turn. Build: d20c809 (round-4 changes: chained steps, open-failure reminder, compact page output, gated write settle). Set 4 was written before any LLM run on it. Transcripts are not committed (large).

72 valid trial-arms (36 per arm). Eleven trial-arms were invalidated by the Playwright browsers being deleted from `~/Library/Caches` while the run was in progress (their transcripts say the browser executable is missing); they were discarded and re-run, and only the re-run rows are kept. No gateway errors. `trials.jsonl` holds the merged valid rows (runs `-`, `-b`, `-c`, `-d`, `-e`); the invalid rows are not kept.

| measure | Playwright MCP | Vedha MCP |
|---|---|---|
| effect completed | 18 / 18 | 17 / 18 (1 false fail) |
| defect twins detected / missed | 10 / 8 | 16 / 2 |
| median tokens (prompt+completion), effect cells | 76,018 | 52,990 (-30%) |
| median tokens, defect cells | 210,000 | 139,029 (-34%) |
| median wall time, effect / defect | 169 s / 281 s | 176 s / 292 s (+4% / +4%) |
| median tool calls, effect / defect | 14 / 23 | 16 / 43 |
| forced final turn (effect / defect) | 4 / 13 | 3 / 15 |

Pre-registered criteria: defect misses <= 1/3 of Playwright's (met, 2 vs 8); effect completion within one task (met, 17 vs 18); tokens >= 20% lower on effect and defect cells (met); latency not worse than Playwright (NOT met: +4%, within noise but not better); harness errors < 5% (met after re-running the 11 environment-invalidated trial-arms).

Losses: one false fail (W25-password-form t0: the page, the write (200) and the event log all confirmed success; the model reported failure because it could not read back the stored password, a value the page never exposes). Two misses on W26 carousel error twin (t1, t2): the model saw the failed state and reported success anyway. Vedha uses more tool calls than Playwright, especially on defect cells (43 vs 23).

One free model, n=3 per cell. The false-fail fix made after this run (a passed step that sent a write now prints `effect: server confirmed (...)`) is NOT measured here; set 4 is no longer held-out for later runs.
