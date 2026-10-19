# Implementation status (updated 2026-10-19)

Project name: **Vedha** (renamed from the working name AgentFirst; packages `@vedha/*`, CLI `vedha`, schema ids `vedha.*/v1`).

## Phase summary

| Phase                | Status                          | Evidence                                                                                                                                                    |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Environment + REA  | **Done, one gap**               | `research/environment.md`; REA 6.7.0 CLI used; MCP registered but **MCP tools not invoked in-session** (needs a Claude Code restart; Q14)                   |
| 1 Playwright via REA | **Done**                        | 10 deliverables in `research/`; ledger `research/evidence-ledger.json` (66 findings); 6 traced scenarios with runtime confirmation                          |
| 2 Ecosystem          | **Done** (depth varies)         | `research/competitive-landscape.md`, `architecture-comparison.md`, `agent-testing-gaps.md`; Skyvern/Magnitude only metadata + README                        |
| 3 Gap matrix         | **Done**                        | `research/playwright-gap-matrix.md`                                                                                                                         |
| 4 Design             | **Done**                        | `design/` (3 proposals, selection, migration, 6 ADRs)                                                                                                       |
| 5 Benchmark          | **Done (scripted-actor scope)** | 15 scenarios, 5 drivers, frozen + post-fix runs (1,500 trials each), cross-browser track, observation track; LLM agents and competitor products **not run** |
| 6 MVP                | **Done**                        | `packages/{core,adapter-playwright,cli}`                                                                                                                    |
| 7 Security           | **Done within stated limits**   | `SECURITY.md`: redirect hops, POST redirects, WebSockets, service workers (launched sessions) all tested in a real browser                                  |
| 8 DX                 | **Done**                        | `README.md`, `CONTRIBUTING.md`, `examples/`, migration doc, CI workflow (never executed)                                                                    |

## Tests executed (final state)

- `pnpm build` clean; `eslint .` 0 problems; `prettier --check .` clean.
- `vitest run`: **61 tests passed** (core unit incl. runner decisions with a fake adapter, implicit read-back, exact targets, verifiers, policy/redaction/path guards, observation levels/deltas, bundle/replay/promotion, schema validation; real-browser integration; CLI end to end).
- Integration suite re-run with `VEDHA_BROWSER=firefox` and `=webkit`: 15/15 pass on each.
- Benchmarks: `vedha-n20-frozen` and `vedha-n20-postfix` (1,500 trials each, 0 harness errors); `xb-firefox`, `xb-webkit` (150 each); observation track (n=10). See `benchmarks/analysis/vedha-n20-interpretation.md`.
- Upstream Playwright's own tests: **not run** (needs explicit approval to execute upstream scripts; no `verified_test` ledger entries).

## Honest results summary

- Seeded-defect false passes (post-fix, 100 trials per driver): pw-trust 40%, pw-test 40%, pw-strong 0%, pw-heal-naive 60%, vedha 0%.
- Hold-out caveat: on the first, frozen run Vedha scored 0/20 on S12 (input step without postcondition ⇒ `uncertain`) and its label matching was too loose (S13). Both fixed afterwards; post-fix S12/S13 are not hold-out.
- S13, S14 and S15 do not separate the drivers (all pass); they confirm absence of collateral damage.

## Outstanding gaps / blockers

- **No LLM provider key**: no LLM-driven comparison (browser-use, Stagehand, agent-browser, Midscene, Playwright MCP agents); observation track reports characters, not tokens.
- Scenarios and framework share an author; no independent hold-out set. Not built: multi-tab, responsive/visual, long-horizon, unfamiliar apps, real third-party sites.
- REA MCP server not exercised in-session; REA could not resolve `this.method()` call edges (E-060).
- Policy limits: after an allowed POST redirect the page URL stays at the POST URL; `fromPage` sessions cannot block service workers; DNS rebinding / IP-literal tricks beyond hostname matching not handled.
- CI workflow never run; package not published to npm.

## Unverified assumptions

- Playwright 1.64.1 runtime behaviour equals 1.65.0-next source behaviour (Q1).
- Ref stability beyond DOM insertion (Q8 partial).
- `pw-strong` as an "expert" baseline is the author's reconstruction.

## Next highest-value tasks

1. Model key/budget → LLM `Actor` adapter outside core; same scenarios, same model and prompt across Playwright MCP, browser-use, Stagehand, agent-browser, Vedha.
2. Independently authored hold-out scenarios and a trial on a real app.
3. Run selected upstream Playwright tests in an isolated build (needs approval); close Q1.
4. Restart Claude Code and re-run key Phase 1 queries via REA's MCP tools.
5. Run CI on GitHub; publish packages when ready.
