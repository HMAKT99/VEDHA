# Pre-registration: held-out evaluation of Vedha against Playwright and Selenium

Status: written and committed BEFORE any held-out trial is run. Amendments are allowed only as new commits that precede the run they affect, and every amendment is listed at the end. Results are reported against this document, including where Vedha loses.

## Question

For browser tasks driven by a script or by an LLM, does Vedha (verified actions, bounded recovery, repeat guard, page-health check, shared agent feedback) produce fewer wrong outcomes than plain Playwright, an expert Playwright Test setup, plain Selenium and an expert Selenium setup, without completing fewer tasks?

## Frozen and unfrozen

- Framework under test: the git tag `prereg-v1`, created on the commit that contains this file. No change to `packages/` after the tag is used for a held-out run. Fixes found during a held-out run go on a later commit and are reported as post-freeze.
- Tuning set (already seen, NOT hold-out): scenarios S01-S15, the order/login/rows fixtures, LLM pilots 1 and 2 (S01, S02, S03, S04, S06, S07, S09, S10).
- Held-out set (never used to change the framework):
  1. **Widget families** W01-W10 on `benchmarks/fixtures/widgets.ts` (hover menu, double click, uncheck, upload, scroll-triggered load, drag and drop, confirm dialog, popup tab, iframe form, history back). Each has a healthy variant (effect happens and is visible in a server-side event log) and a seeded-defect variant (the UI reports success while the server records nothing or returns 500). Oracle = the fixture server's event log, hidden from drivers.
  2. **Independent applications** (not written by this project's author): local copies of TodoMVC (MIT) and the-internet (MIT) with mutation-style seeded defects (for example: delete handler does nothing, filter off by one, save returns 500). Oracle = application state read by the harness. This track is specified in an amendment that precedes its run; if it is not built, the report says so.
  3. **LLM track**: S02, S03, S09 (never run before the framework changes) plus the widget families, MCP vs MCP.

## Arms

Scripted (no model): `pw-trust`, `pw-test`, `pw-strong`, `pw-heal-naive`, `sel-trust`, `sel-strong`, `vedha`. `sel-strong` uses explicit waits, UI assertions, fetch instrumentation for response checks, known-banner dismissal and one whole-test retry (the Selenium counterpart of `pw-strong`; no alternate locators, no read-back).
LLM (MCP vs MCP): `@playwright/mcp` 0.0.83 and `@vedhajs/mcp`, same model, system prompt, tool-result cap and turn limit, provider pinned, temperature 0. The model ends a run with "RESULT: success|failure"; that claim is classified against the oracle. Vedha's own report verdict is recorded as a secondary signal.

## Metrics (per arm and per scenario category; categories are never merged)

1. Correct outcome rate: effect scenario, claim pass and effect achieved; defect scenario, claim fail AND the effect request was actually sent (otherwise `detected_without_submit`, excluded).
2. False-pass rate: claim pass without the effect, or any pass on a defect scenario.
3. Duplicate side effects per trial.
4. Completion rate on healthy scenarios (claim pass and effect achieved).
5. Cost proxies: LLM calls, prompt+completion tokens, tool-result characters, wall time.
   Uncertain claims are never counted as correct.

## Decision rules

- Vedha is called better than an arm on a dimension only if, on the held-out set, (a) its completion rate on healthy scenarios is not lower (point estimate within 5 percentage points, Wilson 95% intervals overlapping or better) AND (b) its false-pass rate is lower with non-overlapping Wilson 95% intervals, or its duplicate rate is lower under an exact sign test p < 0.05.
- Where those conditions fail, the report says "no evidence of an advantage" or "worse", whichever the data show. A dimension is never dropped to make a comparison look better.
- Trials: scripted n >= 20 per cell; LLM n >= 5 per cell on the headline scenarios. Smaller N is labelled a pilot and supports no "better" statement.
- Harness errors are reported, not silently re-run; a cell with more than 5% harness errors is invalid.

## Known limits (stated in advance)

Synthetic apps; one model family; the free-tier model may change behaviour or availability; scenarios and framework share an author except for the independent-application track; Selenium baselines are the author's reconstruction of an expert setup; Chromium only for Selenium.

## Amendments

(none yet)

**A4 (after `prereg-v1`, before any further held-out run; disclosure).** Changes made after the tag, all additive or harness-side, with the reason:

- Held-out Selenium cells were re-run on a quiet machine because the first run lost Chrome sessions under load (381 "invalid session id" errors of 680, over the 5% validity limit). The Selenium drivers now recreate a dead session. The Playwright-family and Vedha rows of the first run (3 harness timeouts of 1,700) are valid and were merged with the valid Selenium rows (`analysis/merge.ts`; combined results `heldout-n20-final`, `heldout-min-n20-final`).
- Independent-application track (TodoMVC with seeded mutants), built and smoke-tested after the freeze: checks were redefined so a stale page cannot satisfy them (the first definitions let the assertion pass on the pre-render DOM, so detection depended on timing), setup steps are marked `enabling`, and the toggle-all target was corrected. Those scenarios were seen at n=2 before this amendment; their n=20 run will say so.
- Fixtures: the shop fixture no longer crashes on a malformed JSON body (found when an agent probed the API). Not a framework change.
- Framework, additive and not part of the `prereg-v1` evaluated behaviour: `css` targets, JUnit output, the Playwright Test fixture, an opt-in `synchronous` flag, secret redaction of every MCP tool result (`--secret`).
- LLM turn limit: pilot 3b hit the 14-turn cap on every defect scenario because the model kept investigating; later LLM tracks use a larger cap, the same for both arms.
