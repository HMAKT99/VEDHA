# Architecture proposals (Phase 4)

Evidence base: `research/playwright-gap-matrix.md` (G1-G11), Phase 1 ledger (E-xxx), Phase 2 ledger (P2-xxx). Effort scale: S/M/L as in the gap matrix. All "advantages" are design arguments, not measurements.

## Common requirements derived from the gaps

R1 outcome verification independent of the actor (G1) · R2 recovery that preserves the original failure (G2) · R3 exploration → reviewable deterministic tests (G3) · R4 bounded/delta observations (G4) · R5 `outcome_unknown` for mutating actions (G5) · R6 failure bundle + replay (G6) · R7 fail-closed policy (G7) · R8 useful without an LLM · R9 replaceable browser adapter · R10 reuse Playwright's proven actionability (Phase 1 §strengths).

---

## Architecture A - Agent-native layer over a mature engine

**Core abstractions:** `BrowserAdapter` (Playwright impl), `Observation`, `ActionSpec`, `Verifier`, `RecoveryPolicy`, `TraceEvent`.

- **Browser integration:** Playwright `Page` behind `BrowserAdapter`; reuses actionability, auto-wait, tracing, network routing.
- **Observation:** `page.ariaSnapshot({mode:'ai'})` (E-021) + URL/title + recent console/network events; levels and deltas computed in our layer.
- **Action model:** `ActionSpec{intent, target, op, preconditions, postconditions, timeout, idempotency}`; executes with Playwright locators; returns `ActionResult{status, evidence}`.
- **Verification:** deterministic verifiers run by the framework after each action (URL, element state/text, network response matcher, custom invariant callback).
- **Recovery:** bounded ladder with `RecoveryRecord`s.
- **Test generation:** none beyond recording actions to a log.
- **Debugging/replay:** trace + step log; no promotion.
- **Security:** policy object enforced at adapter (route-level domain allowlist).
- **Extensibility:** custom verifiers/recovery strategies/adapters.
- **Performance:** one extra observation per step only when requested; verifiers are local calls (no model).
- **Compatibility:** runs inside Playwright Test as a fixture; existing tests unaffected.
- **Advantages:** smallest; directly addresses G1, G2, G4, G5; low risk.
- **Disadvantages:** no story for exploration/promotion (G3, G9) or replay (G6); users must still author specs.
- **Cost:** M. **Risks:** value limited to people already writing action specs.

## Architecture B - Own testing runtime

**Core abstractions:** own scheduler, state model, action protocol, CDP client (or Playwright-free), verification & recovery inside the runtime.

- **Browser integration:** direct CDP (like browser-use, P2) or a custom daemon (like agent-browser, Rust, P2).
- **Observation/action/verification/recovery:** same concepts as A but implemented against raw CDP; must re-implement actionability, hit-target checks, frame/lifecycle tracking, stability (E-005, E-008).
- **Advantages:** full control of timing/retry policy (the only part Playwright does not expose - extension-points §Not extension points); potential to avoid RPC layers.
- **Disadvantages:** reimplements ~6-8k lines of hard-won browser logic (`frames.ts` 1.9k + `dom.ts` 1.1k + injected script) and loses Firefox/WebKit; **no Phase 1/2 evidence that the engine or its RPC overhead is a bottleneck** for agent testing.
- **Cost:** L+. **Risks:** reliability regressions on dynamic UIs - exactly the area where Playwright is strongest.
- **Compatibility:** none with Playwright tests.

## Architecture C - Hybrid deterministic + autonomous system

**Core abstractions:** A's abstractions **plus** `Goal`, `Explorer` (pluggable policy: scripted or model-driven), `TestProposal`, `Promoter`, `FailureBundle`, `Replayer`, `Orchestrator`.

- **Browser integration:** as A (adapter), so Playwright semantics are kept for both deterministic and autonomous modes.
- **Observation model:** as A.
- **Action/verification/recovery:** as A; every action in exploration is a verified `ActionSpec`, so exploration output is _already_ structured for promotion.
- **Test generation:** `TestProposal` (preconditions, steps, expected outcomes, independent assertions, cleanup, evidence, confidence, assumptions) → `promote` emits a Playwright Test spec and runs a replay check.
- **Debugging/replay:** `FailureBundle` (goal, observations, ActionSpecs, verdicts, recovery records, network/clock refs, versions) → `replay` re-drives and reports divergence; states when replay is impossible.
- **Security:** policy at adapter + destructive-action gate + redaction + untrusted-content labelling in observations given to an actor.
- **Extensibility:** actor interface (`decide(observation, goal) → ActionSpec | done`) is provider-independent: scripted, rule-based, or LLM adapter (not shipped as mandatory); integrations: CLI, SDK, JSON, optional MCP server.
- **Performance:** deterministic replay of promoted tests uses no model calls (addresses G9 by design).
- **Compatibility:** same as A; promoted tests are ordinary Playwright specs.
- **Advantages:** addresses G1-G7 and G9 in one model; the deterministic path and the autonomous path share one action/verify vocabulary.
- **Disadvantages:** largest surface; promotion quality is a research risk (G3 is "hypothesis").
- **Cost:** M-L. **Risks:** over-building before benchmarks justify; mitigated by building A's core first and C's pieces behind interfaces.

---

## Evaluation

| Criterion (weight)                      | A           | B                                          | C                                   |
| --------------------------------------- | ----------- | ------------------------------------------ | ----------------------------------- |
| Covers P0 gaps G1,G2,G3,G8 (0.30)       | G1,G2 (2/4) | G1,G2 (2/4)                                | G1,G2,G3 (+bench) (3-4/4)           |
| Evidence that approach is needed (0.20) | high        | **low** (no evidence engine is bottleneck) | high for core, medium for promotion |
| Feasibility within MVP (0.20)           | high        | low                                        | medium (staged)                     |
| Preserves Playwright strengths (0.15)   | high        | low                                        | high                                |
| Risk (0.15)                             | low         | high                                       | medium                              |
| **Score (1-5, my judgement)**           | 3.9         | 1.9                                        | **4.1**                             |

Scoring is a judgement call (shown so it can be challenged), not a measurement.

## Selection

**C, staged on A's core, Playwright behind a replaceable adapter.** Stage 1 (A) is the benchmarked core; Stage 2 adds `TestProposal/promote` and `FailureBundle/replay`; B is rejected for the MVP and revisited only if benchmarks show timing/overhead from the Playwright layer dominates agent-step latency (ADR-0004).
