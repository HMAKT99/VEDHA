# ADR-0002: Postconditions are verified by the framework, not the actor

Status: accepted.
**Context:** G1. In Playwright's agent tools verification is an actor-invoked tool (E-022); Stagehand/browser-use/Midscene rely on success-by-no-throw or model judgement (P2-043, P2-005, P2-050).
**Decision:** `ActionResult.status='verified'` only if framework-run deterministic verifiers pass; no declared postcondition ⇒ `unverified`. LLM judging may exist as an optional verifier type but never upgrades a failed deterministic verdict.
**Consequences:** + false-pass resistance; − requires specs/inference of postconditions; − `unverified` results are common in naive exploration (by design).
