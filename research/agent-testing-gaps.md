# Agent-testing gaps (Phase 2 input to the Phase 3 gap matrix)

Labels: **confirmed** = absence/presence verified in the pinned source; **hypothesis** = plausible but needs Phase 1/3 evidence or a benchmark. Nothing here is measured; no gap claims a performance number. "Exists elsewhere" says which studied project already has a version of it. Evidence IDs → `ledger-fragments/phase2.json`.

| # | Gap | Status | Exists elsewhere | Evidence | Benchmark needed |
|---|---|---|---|---|---|
| G1 | **Incremental/delta observations in the Playwright agent interface.** PW `snapshot.mode` is `full\|none` only; every action response re-sends a full snapshot when enabled. | confirmed (absence in PW config); token impact is a hypothesis | agent-browser `snapshot --delta` (full → `unchanged` / structural delta, falls back to full on URL change) | P2-003, P2-031 | tokens per task, paired, same model |
| G2 | **Post-condition verification bound to the action.** PW actions return after settle heuristics; verification is separate caller-driven `browser_verify_*` tools. AB has none built in; BU's judge is report-only; SH `act` success = no throw; Midscene `aiAssert` is model-judged. | confirmed (structure) ; effect on false-pass rate is a hypothesis | PW verify tools (explicit); Midscene aiAssert (LLM) | P2-004, P2-005, P2-022, P2-043, P2-050 | false-positive/negative on seeded-bug apps |
| G3 | **Recovery that preserves the original failure.** SH `selfHeal` retries with a new LLM-picked element and returns only the new outcome; PW healer is a prompt that edits tests. No studied code records (failure, recovery attempt, outcome) as one record. | confirmed for SH; PW healer confirmed as prompt-only; "no other project does it" is *unverified* (BU/Midscene retry paths not fully read) | SH selfHeal (default off); BU step retries | P2-042, P2-006 | seeded real-defect that a heal would mask; measure masked-defect rate |
| G4 | **Honest "outcome unknown" state.** AB returns `outcome_unknown` instead of re-sending a mutating command. No other studied tool has an equivalent documented result state. | confirmed for AB; absence elsewhere = inferred | AB | P2-032 | transient-failure scenarios: duplicate-action rate |
| G5 | **Exploration → deterministic regression test.** PW emits code per action and has a generator spec, but conversion quality (assertion independence, cleanup, stable locators) is untested. BU/SH replay artifacts are not reviewable test files. | partial: capability confirmed in PW; quality = hypothesis | PW `addCode`, generator agent; BU `rerun_history`; SH `Action` replay; Midscene YAML | P2-007, P2-023, P2-044 | replay pass-rate on mutated UI, review effort |
| G6 | **Cross-engine, provider-neutral core with security that fails closed.** Origin filtering in PW MCP is documented as not a security boundary; AB is stronger but CLI/daemon-bound and Chromium-centric; SH/BU tie to own stacks. | confirmed (PW statement; AB behaviour); demand = hypothesis | AB allowlist, BU watchdog, SH domainPolicy | P2-008, P2-033, P2-024, P2-045 | red-team fixtures (redirects, subresources, injected instructions) |
| G7 | **Replayable failure bundles that capture goal + observations + verification.** PW has `session.md`/traces; BU has history/gif; AB has trace/record. None studied bundles goal, observations, verification results and recovery attempts in one schema. | hypothesis (partially read) | PW traces, BU history, AB trace | P2-009, P2-025 | reproduction rate of seeded failures |
| G8 | **Independent oracles for evaluation.** Project evals exist (AB `evals/` for skill loading/command usage; SH datasets webvoyager/onlineMind2Web; BU `tests/ci`), but they are task-success oriented; seeded-bug discovery and false-pass measurement were not found. | hypothesis (absence not exhaustively searched) | SH datasets, AB evals | P2-034, P2-046 | the Phase 5 harness itself |
| G9 | **Model-call reduction via deterministic fast paths.** SH replays `Action` objects and caches; BU reruns history; PW tools are deterministic once refs are chosen. Whether a unified policy beats these is open. | hypothesis | SH cache, BU rerun | P2-041, P2-023 | model calls per task, repeated runs |

## Not gaps (already well covered; preserve)
- Ref-based accessibility snapshots with scoping (PW, AB).
- Settle-after-action heuristics in PW (`backend/utils.ts:20-57`) — imperfect (fixed 500 ms / 5 s ceilings, P2-004) but present.
- Domain allowlisting (AB, BU, SH).
- Browser-engine limits (cross-browser coverage, anti-bot) belong to the engine layer, not the agent interface.

## Caveats
Midscene, Skyvern, Magnitude, SH `agent`, BU `actor`/MCP, and AB `chat` were not studied at implementation depth. Absence claims above are limited to what is cited.
