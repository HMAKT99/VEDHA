# ADR-0001: Use Playwright as the initial browser substrate behind a replaceable adapter

Status: accepted. Date: 2026-10-18.
**Context:** Phase 1 shows Playwright's server-side auto-wait/actionability/hit-target machinery is the strongest part of the stack (E-005, E-008, E-040); nothing in Phase 1/2 shows the engine is the bottleneck. Brief forbids a mere wrapper, so Vedha must own agent-first behaviour.
**Decision:** Implement `BrowserAdapter` and ship a Playwright implementation. Vedha owns ActionSpec, verification, recovery, policy, observation levels/deltas, promotion and bundles.
**Consequences:** + reliability and cross-browser potential; + no reimplementation of hard code; − cannot change Playwright's internal retry policy (extension-points); − adapter surface must stay small to keep replacement feasible.
**Revisit when:** benchmarks show adapter/Playwright overhead dominates step latency, or a needed capability is impossible via public API.
