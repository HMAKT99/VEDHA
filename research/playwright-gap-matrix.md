# Playwright / agent-testing gap matrix (Phase 3)

Inputs: Phase 1 (`playwright-*.md`, ledger E-0xx), Phase 2 (`agent-testing-gaps.md`, ledger P2-xxx). **Nothing below is a measured result.** "Confirmed" = absence/presence verified in pinned source or runtime; "Hypothesis" = needs the Phase 5 benchmark. Effort: S ≤ 1 wk, M ≈ 2-3 wk, L > 1 mo (one engineer).

## 0. What Phase 1 shows Playwright already does (so we do NOT rebuild it)

| Capability | Evidence | Decision |
|---|---|---|
| Auto-wait + actionability + hit-target checks in one RPC (zero retry round-trips) | E-005, E-008, E-040 | **Reuse via Playwright** |
| Locators incl. role/text/test-id, strictness, custom engines | `selectors.register` (E-extension) | Reuse |
| Compact ARIA snapshot with `[ref=eN]`, depth and bbox options | E-021, E-072 | Reuse as primary observation |
| Call log with actionability reasons; ARIA snapshot on expect failure | E-010, E-040, E-043 | Reuse; add structured form |
| Trace (before/after, DOM snapshots, screencast, logs) and agent-readable `trace` CLI (2.4 KB for a 2-action failure) | E-044, E-070, E-071 | Reuse; do not compete on viewing |
| `error-context.md` LLM failure brief | E-031 | Reuse idea; extend schema |
| Action → generated Playwright code | E-024 | Reuse as the code emitter |
| Overlay handlers (`addLocatorHandler`), network routing/HAR, clock | E-011, extension-points | Reuse |
| Parallelism, sharding, fixtures, retries, reporters | E-050, E-051 | Reuse (run Vedha tests inside Playwright projects when wanted) |

## 1. Ranked gaps

Priority = (confirmed? × impact on agent-driven testing × feasibility). P0 = build in MVP; P1 = build if time; P2 = design only.

### G1 - Action outcomes are not bound to independent postconditions  **P0**
* **Problem:** An action "succeeds" when no exception is thrown; whether the intended effect occurred is left to a separate caller step.
* **Evidence:** `locator.click` returns `void` (`client/locator.ts:122`), server returns `'done'` (E-008). Playwright agent tools: verification is separate agent-called `browser_verify_*` doing `count()>0` on the same page (E-022). Stagehand `act` success = no throw (P2-043). browser-use judge is report-only (P2-005). Midscene `aiAssert` is LLM-judged (P2-050).
* **Playwright support:** Web-first `expect` is excellent for *authored* assertions (E-010) but not tied to action intents.
* **Competitors:** none found binding action→oracle→verdict in one record (absence inferred; BU/Midscene paths only partly read).
* **Root cause:** Library API is imperative; agents get free-form tool results.
* **Affected workload:** autonomous exploration, goal-driven tests, regression of agent-written tests; false passes (agent claims success).
* **Proposal:** `ActionSpec{intent, preconditions, postconditions[]}` with deterministic verifiers (URL, element state, text, network response, storage/app invariant callback) evaluated by the framework, never by the actor; verdict `verified | failed | unverifiable`.
* **Benefits (hypothesis):** lower false-pass rate; failures localized to the step.
* **Trade-offs:** postconditions must be specified or inferred; inferred ones can be wrong.
* **Benchmark:** B-seeded-bug apps with hidden oracles; metric = false-positive/negative rate vs Playwright+MCP agent claims. **Effort:** M.

### G2 - Adaptive recovery can hide real defects  **P0**
* **Evidence:** Stagehand `selfHeal` (default off) retries with a new element and returns only the new outcome (P2-042); Playwright healer is a prompt that edits tests (P2-006); `addLocatorHandler` runs arbitrary user code without a record (E-011).
* **Root cause:** recovery is treated as success-path plumbing, not as evidence.
* **Proposal:** bounded recovery ladder (re-observe → alternate locator → dismiss known interstitial → wait/retry transient) producing `RecoveryRecord{original_failure, strategy, attempt_outcome}`; a recovered step is reported `passed_with_recovery` and any recovery on an assertion step is forbidden by default.
* **Benefit (hypothesis):** reliability on changed UIs without masking seeded defects.
* **Trade-off:** more `passed_with_recovery` noise; policy tuning.
* **Benchmark:** mutated-UI scenarios (benign change) vs seeded-defect scenarios (real bug); metrics: recovery success rate, masked-defect rate (must be 0). **Effort:** M.

### G3 - Exploration → reviewable deterministic regression test (promotion)  **P0**
* **Evidence:** Playwright converts tool actions to code (E-024) and has a generator prompt (`pw:agents`), but conversion quality (assertion independence, cleanup, locator stability) is unmeasured (P2-007, P2-044). BU/SH replay formats are not reviewable test files (P2-023).
* **Proposal:** exploration produces `TestProposal{preconditions, steps, expected outcomes, assertions (each tied to a verifier), cleanup, evidence, confidence, assumptions}`; `promote` emits a standard Playwright Test spec using role/test-id locators observed at verification time, plus a replay check that the emitted test passes against the explored state.
* **Benchmark:** replay pass rate on original and mutated UIs; review effort proxy (lines, assumptions flagged); seeded-bug detection of promoted tests. **Effort:** M-L.

### G4 - Observation efficiency (deltas, bounded detail)  **P1**
* **Evidence:** Playwright tools: `snapshot.mode` `full|none` (E-023); agent-browser has `snapshot --delta` (P2-003, P2-031). ARIA snapshot already compact (E-021).
* **Proposal:** observation levels (`outline` → `region` → `element detail` on demand), delta vs previous observation keyed by refs, token budget.
* **Hypothesis:** fewer tokens per step with unchanged success. Gain depends on page size - **unknown until measured**.
* **Benchmark:** tokens/task, paired, same model. **Effort:** S-M.

### G5 - Unsafe repeat of mutating actions after uncertainty  **P1**
* **Evidence:** agent-browser `outcome_unknown` (P2-032); Playwright retries internal polling only until action dispatch (retry loop returns after input is performed - E-008) but a *client-level* retry by an agent after timeout can double-submit (hypothesis).
* **Proposal:** idempotency classification of actions (`safe`, `mutating`) and `outcome_unknown` verdict with verification-before-retry. **Benchmark:** transient failure scenario (response delayed after commit); metric = duplicate-action rate. **Effort:** S.

### G6 - Failure bundles that replay *intent*, not just a recording  **P1**
* **Evidence:** Playwright trace is rich but not re-drivable (E-073, Q4); `trace` CLI is compact (E-070). Environment determinism metadata is minimal (`context-options` only: E-071).
* **Proposal:** `FailureBundle{goal, step list with ActionSpec, observations (refs), verifier verdicts, recovery records, network/HAR + clock/seed refs, versions}`; `vedha replay` re-drives with the recorded actions and reports where behavior diverges; explicitly states when exact replay is impossible (external service, nondeterminism).
* **Benchmark:** reproduction rate of seeded failures; divergence detection. **Effort:** M.

### G7 - Security that fails closed for agent-driven browsing  **P1**
* **Evidence:** Playwright MCP docs state origin filtering is not a security boundary (P2-008); agent-browser documents stronger controls, untested (P2-033); page content is untrusted input to LLM actors.
* **Proposal:** policy layer (domain allowlist enforced via network routing incl. redirects/subresources, destructive-action gate, secret redaction, path guards, resource limits). **Benchmark:** red-team fixtures (redirect to disallowed host, injected instruction page). **Effort:** M.

### G8 - Independent-oracle evaluation of agent testing frameworks  **P0 (enabler)**
* **Evidence:** studied repos' evals are task-success oriented (P2-034, P2-046); no seeded-bug false-pass measurement found (absence not exhaustive).
* **Proposal:** the Phase 5 harness (hidden oracles, seeded bugs, paired trials). **Effort:** M.

### G9 - Model-call reduction through deterministic fast paths  **P2**
* **Evidence:** SH cache/replay, BU rerun (P2-041, P2-023). Unified policy value unknown.
* **Proposal:** deterministic-first executor: replay promoted steps, call a model only on verifier failure. **Benchmark:** model calls/task over repeated runs. **Effort:** M (depends on G3).

### G10 - Long-horizon workflows & unfamiliar-app exploration quality  **P2 (unknown)**
* Not enough evidence in Phase 1/2 to call this a gap (competitors not run). Treat as benchmark scenarios, not design drivers.

### G11 - Per-attempt retry diagnostics hidden by log compression  **P2 (hypothesis)**
* `compressCallLog` collapses repeated blocks (E-… `callLog.ts:17`); only observed as `N ×` groups. Agents likely do fine with it; do not prioritize unless Phase 5 diagnostic-quality scoring says otherwise.

## 2. Gaps that are **not** gaps (explicit non-goals)
* A new browser engine/protocol (no evidence Playwright's engine, actionability or isolation is the bottleneck - see E-005/E-008/E-040).
* Another snapshot format (Playwright's ARIA `mode:'ai'` is compact and ref-stable under insertion - E-021, E-072).
* A trace viewer (E-070).
* Cross-browser coverage (inherit via Playwright adapter; browser-use/Stagehand-v4 are Chromium-bound, P2).

## 3. Decision summary

| Rank | Gap | Priority | Status | MVP scope |
|---|---|---|---|---|
| 1 | G1 outcome verification | P0 | confirmed structure; effect = hypothesis | yes |
| 2 | G2 recovery preserving failures | P0 | confirmed (SH); effect = hypothesis | yes |
| 3 | G3 promotion to regression test | P0 | partial; quality = hypothesis | yes (basic) |
| 4 | G8 oracle benchmark | P0 enabler | - | yes |
| 5 | G4 observation deltas | P1 | confirmed absence in PW tools; value = hypothesis | yes (simple) |
| 6 | G5 outcome-unknown | P1 | confirmed (AB); need = hypothesis | yes (small) |
| 7 | G6 failure bundle/replay | P1 | hypothesis | yes (basic) |
| 8 | G7 security policy | P1 | confirmed (PW statement) | yes (domain + redaction + gates) |
| 9 | G9 deterministic fast path | P2 | hypothesis | via promotion |
| 10 | G10, G11 | P2 | unknown | benchmark only |
