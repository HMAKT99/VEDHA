# REA investigation log (Phase 1; Phase 2 appended in `rea-investigation-log-phase2.md`)

REA = `rea-agents@6.7.0` (repo `morluto/rea@093ce695`). Run via CLI under Node 22.20.0. **The REA MCP server was registered but not callable in this session** (needs a client restart); the CLI shares its workflows and Evidence contracts per `docs/cli.md`. No claim is made that MCP tools were invoked.

| # | When | Command / operation | Input | Output (path, size) | Result | Used for |
|---|---|---|---|---|---|---|
| L-01 | setup | `npx rea-agents@latest setup --client claude_code --skill=false --dry-run --json` | - | stdout | First try: `Unsupported agent integration` (client id is `claude_code`); second try on Node 24.9 timed out in Ghidra check (ETIMEDOUT 120 s); third try on Node 22.20 returned a plan | Phase 0 setup |
| L-02 | setup | `rea setup --client claude_code --skill=false --yes --json` (v6.7.0) | - | `~/.claude.json` edit, backup `~/.claude.json.rea.backup` | `configured_claude_code`; env not healthy for native providers (not needed) | MCP registration |
| L-03 | P1 | `rea analyze-javascript-application <upstream>/playwright/packages/playwright-core/src --json` | 331 files | `rea-evidence/pwcore-src-analysis.json` (159 MB, gitignored) | 5,319 inventoried items; 532,496 AST nodes; 0 parse failures; graph 4,948 module nodes / 5,821 edges (4,338 imports, 784 exposes, 662 contains, 19 calls, 8 loads, 10 persists_to); semantic graph **truncated at node ceiling** (100,000 nodes, 51,443 relations; function nodes in 101 modules) | module inventory, boundary matrix |
| L-04 | P1 | `rea inspect-analysis-view` summary | L-03 evidence | `rea-evidence/pwcore-summary.json` (12 KB) | summary + limitations list | coverage statement |
| L-05 | P1 | `rea trace-application-feature` seed `module=server/dispatchers/dispatcher.ts`, direction both | L-03 evidence | `rea-evidence/queries/q001-out.json` (23.5 MB) | Matched module + asset nodes; reachable import subgraph. Used as import-neighborhood sanity check only | dispatcher dependency neighbourhood |
| L-06 | P1 | `rea analyze-javascript-application <slice>` | 24 copied files (frames, dom, progress, page, browser*, network, input, selectors, dispatchers, crConnection/crBrowser, client channelOwner/connection/locator/frame/page/browserType/waiter) under `rea-evidence/slices/core-exec` (copies; upstream untouched) | `rea-evidence/core-exec-analysis.json` | semantic graph 48,210 nodes / 36,192 relations, status `unknown`, not truncated | recover functions for frames.ts/dom.ts which L-03's semantic graph omitted |
| L-07 | P1 | `rea trace-javascript-semantics` `callers` of `Frame.retryWithProgressAndBackoff`, `_retryWithProgressIfNotConnected`, `ElementHandle._retryAction` | L-06 | `queries/s001..s003-out.json` | Seeds found; **0 caller relations**; unknowns `dynamic-call: Unsupported MemberExpression call target` (e.g. `frames.ts:1150`) | tested whether REA gives call graph for OO code: **it does not** (E-060) |
| L-08 | P1 | `rea trace-javascript-semantics` forward-influence of `DispatcherConnection.dispatch` | L-06 | `queries/s004-out.json` | 7 nodes, 6 relations, all `awaits`; 47 unknowns | confirms limited usefulness; call ordering came from reading source |
| L-09 | P1 | jq/node post-processing of L-03 graph | L-03 | `rea-evidence/derived/imports.tsv`, `dir-import-matrix.json` | directory dependency matrix; no client→server edge | E-001 |

## What REA was good for
* Fast, parse-failure-free inventory of 331 TypeScript files with authenticated, source-ranged import edges and unresolved-reference markers (`resolution_status: external|not-found|resolved`).
* Honest uncertainty: every fact carries authority/state/confidence/coverage/limitations; REA refuses to turn missing relations into absence (`javascript-application-workflows.md` "never reports as proven behavioral absence").
* Event inventory: semantic nodes list EventEmitter registrations (e.g. `frameAttached`, `loadstate`, `navigated`, `Target.attachedToTarget`, `Runtime.executionContextCreated`, `locatorHandlerTriggered`, `webSocket`...), 260 event nodes / 166 listeners (partial: 101 modules).

## REA limitations encountered (and supplemental method used)
* **Semantic graph ceiling** (100,000 nodes, per-file 20,000) truncated the broad run → re-ran on a copied slice (L-06). Reason documented here, per brief.
* **No resolved edges for `this.method()` calls** in these classes → call order established by direct source reading with file:line citation, then confirmed at runtime where possible (E-005, E-008, E-040).
* **Application-oriented tool**: REA's JS analyzer targets bundles/Electron apps; its "application graph" ideas (routes, IPC, storage) mostly produced empty/irrelevant nodes for a TypeScript library (`endpoint` 22, `worker` 7, `storage` 10 nodes; not analysed further).
* **Not used:** `trace-web-module-imports`, `capture-browser-scenario` (runs a bounded Playwright browser scenario: not tried; could be used for runtime evidence in a later phase), `reconcile-javascript-runtime`, native providers.

## Supplemental methods (and why)
| Method | Why | Artifacts |
|---|---|---|
| Direct source reading (`sed`/`grep`) | call ordering, exact lines | cited inline |
| Runtime experiments with published `playwright@1.64.1` in isolated dir | REA is static here; need `verified_runtime` | `research/experiments/pw-runtime/{exp1.mjs,exp1-output.json,t/,test-run-output.txt,test-results/}` |
| Directory listing of `tests/` | locate supporting tests (not executed) | `playwright-component-map.md` |

## Environment hazards recorded
* Default Node 24.9.0 is below REA's `^24.11` requirement; REA was run with nvm Node 22.20.0.
* Source pin is 1.65.0-next; runtime used 1.64.1 (npm latest at install time). Differences are not characterised (Q1).

## Round 2 (2026-10-20)
* L-R2-01: `mcp__rea__analyze_javascript_application` (input: pw-build/packages/playwright-core/src/tools/backend, format directory, detail summary). Result: failed after 120 s in the macOS helper compilation (xcrun timeout) while the machine was overloaded. No evidence produced. Not counted as a finding (E-092). To retry when idle.
* L-R2-02: supplemental method: direct reading of `response.ts` (E-091), labelled verified_static from reading, not from REA.
* L-R2-03 (idle machine): `analyze_javascript_application` on tools/backend succeeded (41 files, 29,152 AST nodes, 0 parse failures, modules 0, partial coverage, evidence ev_d4fac013...). L-R2-04: `trace_application_feature` string seed "redactSecrets": no match. L-R2-05: `trace_javascript_semantics` property seed "redactSecrets", callers: no match. Result recorded as E-093: REA MCP gives statistics here but no identifier-level traces on this TypeScript source.
* L-R2-06..08: supplemental direct reading of agent-browser connection.rs (E-094), browser-use service.py (E-095), Stagehand evals (E-096).
