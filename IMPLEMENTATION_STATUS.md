# Implementation status (updated 2026-10-20, after super-plan Phases 0-2)

Project name: **Vedha**. Packages: `@vedha/core`, `@vedha/adapter-playwright`, `@vedha/cli`, `@vedha/mcp`, `@vedha/playwright-test`. Framework freeze tag: `prereg-v1` (see `benchmarks/preregistration.md`, amendments A1-A4).

## What exists

- Core: verified actions, bounded recovery with recorded failures, reconcile, repeat guard with `confirms`, page-health check, hints, shared feedback rendering, observation levels, policy (domains incl. redirect hops, WebSockets, service workers, uploads fail-closed, dialogs, secret redaction), failure bundles and replay, promotion to Playwright specs, JUnit output.
- Actions: goto, click, dblclick, hover, fill, select, check, uncheck, press, upload, scroll, drag, wait, back, reload, switch_tab; targets by role, label, text, test id, ref, css, within, inFrame.
- Surfaces: CLI, SDK, MCP server (`vedha-mcp`), Playwright Test fixture.
- Evidence: 115 tests passing; scripted regression gate unchanged (75/75 vs the post-fix run); CI on the PR branches.

## Measured results (raw data in `benchmarks/results/`; summary and limits in the README)

Held-out widgets full declarations: Vedha ties expert Playwright and Selenium. Minimal declarations: Vedha detects 60/140, every baseline 0/140. Cross-implementation (16 third-party TodoMVC): Vedha 189/192 vs 182-184 for the others, intervals overlap. Independent TodoMVC mutants: Vedha 50/50 at n=5 after idle-aware classification. Read-back inference: 10/10 on a conventional-REST silent drop (positive control), 0/20 on the pre-registered widget silent drops (target missed). B8: promoted test kills 12/12 defects vs 3/12 for recorder-style references. B7: Playwright MCP's origin allowlist leaked 9/9 on redirect and WebSocket cases, Vedha 0/15. B5: +10-110 ms per scenario, planned <=15% relative target not met. LLM pilot 3b: completion tie, Vedha about 18% fewer tokens; pilot 4 (held-out widgets, MCP vs MCP) running.

## Honest limits

Scenarios are author-built except the TodoMVC track; one model family on the free tier; Selenium baselines are the author's reconstruction of an expert setup (Chromium only); overhead measured (B5) but only on tiny scenarios; no external agent benchmark yet (MiniWoB++ needs a model budget); read-back needs a conventional REST convention and missed the pre-registered silent drops; idle-aware classification keeps "unknown" for pages with long-lived requests; REA MCP tools: one call attempted and failed on an overloaded machine (E-092); nothing published to npm; no commit pushed since PR #4.

## Next (see the super plan in the repository history of this session)

Phase 1: RE round 2 on an idle machine; P3 observed-change feedback, P4 result parity, P5 idle-aware classification. Phase 2: P1 read-back inference, P2 witnesses, P6 locator robustness on TodoMVC x8. Phase 3: multi-model LLM track, MiniWoB++ subset, overhead, stress, red-team, test-generation quality. Phase 4: `prereg-v2` freeze and final runs.
