# Vedha - selected architecture (C staged on A)

Working name `Vedha`. Language: TypeScript/Node ≥ 20. Core has no LLM or cloud dependency (R8).

## 1. Package layout

```
packages/core               @vedhajs/core   - schemas, ActionSpec runner, verifiers, recovery, policy, trace/bundle, promotion, explorer loop
packages/adapter-playwright @vedhajs/adapter-playwright - BrowserAdapter over Playwright Page
packages/cli                @vedhajs/cli    - `vedha run|observe|promote|replay|doctor`
benchmarks/                 harness, fixtures, drivers (see methodology)
```

Later (not in MVP): `mcp` server wrapper, LLM actor adapters.

## 2. Core abstractions (all versioned: `schema: "vedha.<name>/v1"`)

- **BrowserAdapter** - `observe(opts) → Observation`, `act(op) → ActResult`, `evaluate verifiers' primitives` (`url()`, `elementState(target)`, `text(target)`, `networkLog()`), `route policy`, `screenshot()`, `close()`. Playwright implementation is the only one shipped. Rationale: R9/ADR-0001.
- **Observation** `{schema, url, title, outline (ARIA text with refs), refs, console[], network[], budget{chars, truncated}, level: outline|region|detail, delta?: {from, added[], removed[], unchanged}, untrusted: true}`. Built from `ariaSnapshot({mode:'ai'})` (E-021); deltas computed by ref/text line diff; region = subtree under a ref; **page text is flagged `untrusted`** and never interpreted by the framework.
- **ActionSpec** `{id, intent, target: Target, op: click|fill|select|press|goto|check|..., value?, preconditions[], postconditions[], timeoutMs, idempotency: 'safe'|'mutating', destructive?: bool, recovery?: RecoveryPolicyRef}`; `Target` = `{role,name,exact?} | {testId} | {label} | {text} | {ref} | {within: Target, target: Target}` (the last resolves ambiguous controls by scoping, e.g. a row).
- **Verifier** (deterministic, framework-run): `urlMatches`, `elementState{visible|hidden|enabled|checked|...}`, `textEquals/contains`, `networkResponse{method,urlPattern,status,jsonPath?}`, `custom(fn)` (invariants, e.g. read back via API). Verdict: `pass | fail | unverifiable` with `evidence`.
- **ActionResult** `{actionId, status: 'verified'|'failed'|'unverified'|'outcome_unknown'|'blocked', verdicts[], recoveries[], error?, durationMs, observationRef?}`. `verified` requires **all** postconditions pass; with none declared the status is `unverified` (never silently `verified`).
- **RecoveryPolicy** `{maxAttempts, ladder: [reobserve, altTargets, dismissKnown, retryTransient], allowOnAssertion: false}`. Each attempt yields `RecoveryRecord{originalError, strategy, outcome}`. A step that passes after recovery is `verified` **with** `recovered: true`; the run summary reports `passed_with_recovery`. `outcome_unknown` arises for `mutating` actions when the call times out/disconnects after dispatch: the runner does **not** re-issue; it runs read-only verifiers (or a user `reconcile` callback) first.
- **Trace** NDJSON of `step_started/observation/action/verdict/recovery/step_finished/policy_block` with monotonic time, redacted.
- **FailureBundle** `{schema, goal, env{versions,viewport}, steps[ActionSpec+result], observations(refs), network(HAR-lite), clock, notes{replayable: bool, reasons[]}}` (dir with JSON + screenshots).
- **Policy** `{allowedDomains[], blockedSchemes, destructiveRequiresApproval, secrets[], maxSteps, maxDurationMs, maxObservationChars}`; enforced in the adapter (Playwright `route` for all requests incl. redirects/subresources) and the runner (gates). Violations → `status: blocked`.
- **Explorer** (autonomous mode): `Actor.decide({goal, observation, history}) → ActionSpec | {done, summary}`; shipped actors: `ScriptedActor`, `RuleActor` (heuristic form-filler/crawler used in benchmarks). LLM actors implement the same interface externally. Explorer enforces budgets and policy, runs each proposed ActionSpec through the same runner.
- **TestProposal** `{schema, goal, preconditions[], steps[ActionSpec], assertions[Verifier], cleanup[ActionSpec], evidence[], confidence, assumptions[]}` and `promote(proposal) → spec.ts` (Playwright Test, role/test-id locators, `expect` assertions, `test.step`) plus a **replay check** (run the generated test; record pass/fail in the proposal).

## 3. Run flow (deterministic mode)

`load scenario/spec → policy.check → for each ActionSpec: [observe?] → preconditions → adapter.act → verifiers → (fail → recovery ladder, bounded) → ActionResult → trace` ; terminal verdict = all steps `verified` (or `passed_with_recovery`). No model involved.

## 4. Autonomous flow

`Explorer(goal, actor, budget)`: observe(level=outline) → actor.decide → runner.execute(ActionSpec) → record → repeat until done/budget/policy block → emit `TestProposal` from the verified steps → optional `promote`. Unverified steps are excluded from proposals or flagged as assumptions.

## 5. What is deliberately reused from Playwright

Actionability/auto-wait/hit-target (E-008), ARIA snapshot with refs (E-021), locators and test-id, `route` for policy, tracing (optionally enabled for the bundle), `@playwright/test` as the promoted-test runtime. Vedha never forks Playwright (extension-points §design implication).

## 6. Interfaces

SDK (`import { Session, runSpec } from '@vedhajs/core'`), CLI (JSON in/out, exit codes: 0 pass, 1 failed, 2 blocked, 3 error, 4 outcome_unknown), file-based JSON schemas (`schemas/*.json`). MCP/others evaluated later (ADR-0005).

## 7. Non-goals (MVP)

Own browser engine/protocol, hosted service, mandatory LLM, visual-diff testing, mobile/Android.
