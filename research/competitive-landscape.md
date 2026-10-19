# Competitive landscape (Phase 2)

Pins: playwright b335271c (1.65.0-next); playwright-mcp b8b4183e (0.0.83); browser-use aa093a84 (0.13.13); agent-browser dac13bb8 (0.39.1); stagehand 10418f98 (workspace 4.0.0, `@browserbasehq/stagehand` 4.2.1); midscene b0dcc8da. Status/licence from `gh api` on 2026-10-18. Evidence IDs (P2-NNN) refer to `ledger-fragments/phase2.json`. "verified" below means read in source; nothing here was executed.

## Repository facts
| Project | Licence | Last push | Main language | Note |
|---|---|---|---|---|
| microsoft/playwright-mcp | Apache-2.0 | 2026-10-16 | JS | `src/README.md:1-3`: source lives in the Playwright monorepo (P2-001) |
| browser-use/browser-use | MIT | 2026-10-17 | Python | uses `cdp-use==1.4.5`, not Playwright (`pyproject.toml:43`) (P2-020) |
| vercel-labs/agent-browser | Apache-2.0 | 2026-10-18 | Rust (CLI+daemon) | no Playwright/Node needed by daemon (`README.md:85-87`) (P2-030) |
| browserbase/stagehand | MIT | 2026-10-17 | TS | v4 = thin SDK + JSON-RPC to a Chrome-extension runtime (P2-040) |
| web-infra-dev/midscene | MIT | 2026-10-16 | TS | AI-vision E2E test framework (README only + `insight.ts`) (P2-050) |
| Skyvern-AI/skyvern | **AGPL-3.0** | 2026-10-18 | Python | README-level only; licence blocks code reuse in a permissive project (P2-051) |
| magnitudedev/magnitude | Apache-2.0 | 2026-10-17 | Rust | **Contradicts the assumption** that it is a browser-testing agent: its README now describes a local LLM inference engine. Not relevant (P2-052) |

## Layer classification
Layers: L1 browser engine · L2 deterministic test runner · L3 agent-facing browser interface · L4 autonomous browser agent · L5 agent orchestration framework · L6 benchmark/eval framework.

| Project | L1 | L2 | L3 | L4 | L5 | L6 |
|---|---|---|---|---|---|---|
| Playwright (core + test) | yes | yes | via `tools/` (MCP/CLI) | planner/generator/healer prompt specs only | — | — |
| playwright-mcp | — (uses Playwright) | — | **yes** (packaging of `tools/`) | — | — | — |
| agent-browser | own CDP client (Chrome/Lightpanda/Obscura; Safari via WebDriver) | no runner (diff/assert-like commands only) | **yes** (CLI + MCP + skills) | `chat` command exists (`cli/src/chat.rs`, unread in depth) | — | benchmarks/ + evals/ |
| browser-use | own CDP layer (`browser/session.py`, watchdogs) | no | MCP server dir exists (unread) | **yes** | agent loop + history rerun | `tests/ci/evaluate_tasks.py` (unread) |
| stagehand v4 | own CDP "understudy" layer inside extension | no | CLI `browse` + SDK | `act/observe/extract` (+agent not studied) | — | `packages/evals` (datasets: webvoyager, onlineMind2Web, webtailbench…) |
| midscene | uses Playwright/Puppeteer/CDP/mobile adapters | YAML + `aiAssert` test layer | — | `aiAct` | — | report generator |

## Key verified facts by project
**playwright-mcp / Playwright `tools/`.** Tools are zod-typed and tagged by capability (`core`, `testing`, `core-input`) and type (`readOnly`, `input`, `assertion`) (`tools/backend/snapshot.ts:38-47,66-95`). Element targeting uses snapshot refs matching `^(f\d+)?e\d+$` or a locator/selector string (`tab.ts:557-575`). After each action the response optionally embeds a full ARIA snapshot; the config only allows `snapshot.mode` `full` or `none` (`mcp/config.d.ts:254-258`). A `testing` capability adds `browser_verify_*` assertion tools (`verify.ts`) and each action emits equivalent Playwright code via `response.addCode/addAction` (`snapshot.ts`, `wait.ts`) — a built-in exploration-to-test path. A session log `session.md` is written with `--save-session` (`sessionLog.ts`, README:446). Playwright also ships planner/generator/healer agent specs (`packages/playwright/src/agents/*.agent.md`, 721 lines total; generators for Claude, Codex, OpenCode, Copilot, VS Code in `generateAgents.ts`). The healer prompt tells the agent to fix selectors/assertions and `test.fixme()` when it is confident the test is right (`playwright-test-healer.agent.md`).

**agent-browser.** Ref-based accessibility snapshots with filters `-i -c -d -s` and `--delta` (full, then `unchanged` or a structural delta) (`README.md:982-1000`). Refs survive across snapshots for surviving elements (`README.md:984`; `native/element.rs` ref map). `diff snapshot` and `diff screenshot` (`README.md:425-433`, `native/diff.rs`). Explicit waits on selector/text/url/load/fn (`README.md:261-283`). Default timeout 25 s; page-changing commands are not re-sent after IPC timeout and fail as `outcome_unknown` (`README.md:1236-1252`) — an explicit "outcome uncertain" state. Security: domain allowlist that also blocks sub-resources/WebSocket/sendBeacon and disables WebRTC, content-boundary markers, `--max-output`, action policy file allow/deny/confirm (`README.md:870-890`, `native/policy.rs:1-80`). Batch execution, trace/profiler/recording, MCP server with typed tools (`README.md:284,440-450,585-650`). It has no test runner or assertion library.

**browser-use.** Per-step LLM output requires `evaluation_previous_goal`, `memory`, `next_goal`, `action` (`agent/views.py:381-405`); `max_failures=5`, `max_actions_per_step=5`, planning and loop-detection on by default (`views.py:59-91`). A post-run LLM judge exists but "does NOT override last_result.success" — it is reported next to self-report (`agent/service.py:1629-1634`) (P2-022). Error handling distinguishes interruption, reconnect, closed browser, other (`service.py:1259-1300`). History can be saved and replayed with element re-matching, retries and AI re-evaluation for extract steps (`service.py:3128-3175,3423,3936`). Security: `allowed_domains/prohibited_domains` in a watchdog (`browser/watchdogs/security_watchdog.py:177-230`), `sensitive_data` handling (`service.py:152,534`), CI tests under `tests/ci/security/`. A "beta" Rust-backed agent path is documented in `BETA_AGENT_INTEGRATION_FEATURES.md`.

**stagehand v4.** `act/observe/extract` go over JSON-RPC (`sdk-ts/src/stagehand.ts:232-300`; `packages/protocol/README.md`) to a service-worker runtime in `packages/extension`. `act()` takes either a string (LLM picks the action) or a previously returned `Action` object (deterministic replay) (`services/actService.ts:62-110`). `selfHeal` defaults to `false` (`actService.ts:77`); on failure the heal path re-snapshots, asks the LLM for a new element and retries once, and the original error is not carried in the result (`actService.ts:399-464`) (P2-042). Two-step act diffs accessibility trees (`diffCombinedTrees`, `actService.ts:203`). Result caching goes through an HTTP cache API with a 5 s ceiling (`clients/cacheClient.ts`). Domain allow/block policy implemented in `understudy/domainPolicy.ts`. Timeouts via a `Progress` deadline object (`understudy/progress.ts`).

**midscene.** `aiAssert` asks a model for a boolean plus "thought"; false throws `Assertion failed… Reason: …` unless `keepRawResponse` (`packages/core/src/agent/insight.ts:147-215`) (P2-050). YAML test cases with `aiAct/aiWaitFor/aiAssert`, HTML/markdown reports and a task cache exist (file names in `packages/core/src`: `report-*.ts`, `task-cache.ts`, `yaml.ts`); contents not read.

## What is **not** established
Token cost, latency and reliability of any project are **unmeasured** here. Benchmarks published by the projects were not re-run. Stagehand `agent`, browser-use MCP/`actor`, agent-browser `chat`, Skyvern internals and Midscene caching/report internals were not studied at source level.
