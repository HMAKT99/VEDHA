# LLM pilot (single model, tiny N)

Same model, prompt and tools in two arms: `llm-plain` (model drives plain Playwright; the harness checks the model's stated expectations; observation = Playwright AI ARIA snapshot) and `llm-vedha` (actions run through Vedha `explore()` with verified postconditions; observation = Vedha `controls`).

- Model: `minimax/minimax-m3.1-flash` via Vercel AI Gateway, provider pinned to `minimax`, no fallback. Free until 2026-10-22; every response reported `cost: 0`; team budget capped at $1 and stayed at $0.00. Free tier allows 5 requests/minute.
- Run: `AI_GATEWAY_API_KEY=... pnpm tsx benchmarks/llm/run-pilot.ts --scenarios S01,S04,S06,S07,S10 --trials 2`
- Raw data: `benchmarks/results/llm-pilot-2026-10-20/` (`trials.jsonl`, `transcripts.jsonl`).

## Result (10 trials per arm, 125 gateway calls, 245,822 prompt + 23,098 completion tokens)

| Scenario                    | llm-plain            | llm-vedha                |
| --------------------------- | -------------------- | ------------------------ |
| S01 clean                   | success, success     | honest_fail, honest_fail |
| S04 renamed button          | success, success     | honest_fail, honest_fail |
| S06 silent 500 (defect)     | missed, uncertain    | detected, detected       |
| S07 wrong quantity (defect) | uncertain, uncertain | detected, detected       |
| S10 late response           | uncertain, success   | honest_fail, honest_fail |

## What this does and does not show

**It does not show that Vedha detects defects better.** In every Vedha-arm trial the order POST count was 0: the model never submitted the order. It chose to interact with the Product dropdown (sometimes after a `click` on a combobox, then a `fill`), the step failed, and `explore()` stops at the first failed step. The "detected" outcomes on S06/S07 are therefore failures caused by that detour, not by Vedha's verification catching the defect, and the healthy-app failures (S01, S04, S10) are the same cause. The plain arm, shown the full ARIA snapshot, went straight to the form fields and submit.

Likely contributors (not isolated): the Vedha arm's observation is a bare controls list without page text or status, so the model has no cue about progress; `explore()` ends the run on any failed step instead of feeding the failure back to the model. Observation tokens and wall time were lower in the Vedha arm (79k vs 190k total tokens) but that is mostly because its runs ended early.

One model, N=2 per cell, no confidence intervals, adapter written by the framework's author. Treat as a smoke test of the plumbing, not as a comparison.

## Pilot 2 (Vedha design at commit bbd7985): not better

Criteria were fixed first (`preregistration-pilot2.md`). Same model and cost guards as pilot 1; 8 scenarios x 2 arms x 2 trials, 184 gateway calls, 430,174 tokens, spend $0.00. Arms here are the custom adapter (`run-pilot.ts`), not the MCP servers.

| Scenario                    | llm-plain          | llm-vedha               |
| --------------------------- | ------------------ | ----------------------- |
| S01 clean                   | success, success   | success, uncertain      |
| S02 slow UI                 | success, success   | uncertain, uncertain    |
| S03 cookie banner           | success, success   | success, uncertain      |
| S04 renamed button          | success, success   | uncertain, uncertain    |
| S06 silent 500 (defect)     | uncertain, missed  | uncertain, uncertain    |
| S07 wrong quantity (defect) | missed, uncertain  | detected, uncertain     |
| S09 transient 503           | uncertain, success | false_fail, honest_fail |
| S10 late response           | success, success   | uncertain, uncertain    |

Healthy scenarios (12 trials per arm): plain completed 11, Vedha 2. Defect scenarios (4 trials per arm): plain gave 2 false passes, Vedha 0 but also detected only 1.

By the pre-registered rule Vedha is **not** better here: it avoided false passes but completed far fewer tasks.

Why (from the transcripts): the model declared checks that could not pass (for example `text_contains "Ada"` against an input value, which is not page text). The order WAS placed, Vedha correctly said `outcome_unknown` and refused to repeat, and the first design then ended the whole run, so the model never got to look at the page and confirm. Four changes followed (all after seeing this result, so later runs are not hold-out for these scenarios): a RepeatGuard that blocks only the repeat instead of ending the run, a `confirms` step that lets an independent check clear an unknown outcome, hints that explain why a check failed (text checks do not read input values), and the page-health check. See `design/decision-records/0007-recoverable-agent-loop.md`.

## Pilot 3b (MCP vs MCP, commit 69cbc9f build): a tie on completion, fewer tokens for Vedha

`@playwright/mcp` 0.0.83 vs `@vedhajs/mcp`, same model (`minimax/minimax-m3.1-flash`), same system prompt, loop and 14-turn cap; 8 scenarios x 2 arms x 2 trials; 374 gateway calls, 2,217,010 prompt + 86,579 completion tokens, spend $0.00. An earlier attempt (`llm-mcp-pilot3-crashed-partial`) died after 8 trials when the fixture server crashed on a non-JSON POST body an agent sent; it is kept only as a record.

|                | completion (healthy, 12 trials) | false passes | median tokens/trial      |
| -------------- | ------------------------------- | ------------ | ------------------------ |
| mcp-playwright | 11/12                           | 0/16         | 82,468                   |
| mcp-vedha      | 11/12                           | 0/16         | 67,640 (about 18% fewer) |

Both arms ended "uncertain" on all four defect trials: the model kept probing the API to understand the discrepancy until the turn cap, then never wrote a verdict. That is a harness limit applied equally to both arms, not a framework result. The one signal that differs is Vedha's own report verdict, recorded outside the model's claim: `failed` or `blocked` on 3 of the 4 defect trials where the model never concluded; Playwright MCP has no equivalent. By the pre-registered rule this pilot supports "completion not lower" and no "better" claim (N=12 healthy trials per arm, wide intervals).
