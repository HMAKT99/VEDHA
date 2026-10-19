# Playwright architecture (reverse-engineered)

Source: `microsoft/playwright` @ `b335271cdc2b57cac2be8ad37c5dd283ac6b8938` (repo version `1.65.0-next`, 2026-10-17). Runtime experiments used the published `playwright@1.64.1` (one minor behind the source; see `open-questions.md` Q1).
Path shorthands: `pwc:` = `packages/playwright-core/src`, `pw:` = `packages/playwright/src`, `inj:` = `packages/injected/src`.
Evidence IDs (`E-xxx`) refer to `evidence-ledger.json`. Status words follow the ledger vocabulary.

## 1. The one-paragraph model

Playwright is a **client/server RPC system with the "server" doing all the thinking**. A thin client library (`pwc:client/*`) exposes the public API and turns every call into a typed message `{id, guid, method, params, metadata{timeout,title,location}}` addressed to a remote object by GUID. A server-side `DispatcherConnection` (`pwc:server/dispatchers/dispatcher.ts`) validates the message, wraps it in a `ProgressController` carrying the **deadline, abort signal and call log**, and invokes the real implementation (`Frame`, `Page`, `ElementHandle`, ...). Those implementations drive the browser through a per-engine **delegate** (Chromium via CDP, plus Firefox, WebKit, BiDi) and run actionability/selector logic **inside the page** via an injected script. The test runner (`pw:`) is a *separate* package layered on the public client API: it supervises worker processes, supplies fixtures, and turns the call log, traces and an AI-oriented ARIA snapshot into failure artifacts.

## 2. Layers (verified)

| # | Layer | Location | Role | Status |
|---|---|---|---|---|
| L0 | Browser engines | external (Chromium/Firefox/WebKit builds) | rendering, JS, network | out of scope |
| L1 | Protocol transport + per-engine delegate | `pwc:server/chromium/crConnection.ts` (CRConnection/CRSession, sessionId-multiplexed), `crBrowser.ts`, `crPage.ts`; siblings `server/firefox`, `server/webkit`, `server/bidi` | engine-specific commands/events normalised to common `PageDelegate` | verified_static (E-006) |
| L2 | Server object model | `pwc:server/{browser,browserContext,page,frames,dom,network,input,...}.ts` | engine-agnostic semantics: lifecycle, navigation, actionability, retries | verified_static |
| L3 | In-page injected script | `inj:injectedScript.ts` (+ selector engines, `roleUtils.ts`, `ariaSnapshot.ts`) | selector resolution, element-state checks, hit-target interception, expect matching, ARIA tree | verified_static |
| L4 | Dispatch/RPC | `pwc:server/dispatchers/*`, protocol validators generated from `packages/protocol` | schema-validated, GUID-addressed calls; abort and wait-info side channels | verified_static (E-003) |
| L5 | Client API | `pwc:client/*` (`channelOwner.ts`, `connection.ts`, `locator.ts`, `frame.ts`, `page.ts`, `browserType.ts`) | public API + client-side instrumentation zone (`apiZone`) | verified_static (E-002) |
| L6 | Test runner | `pw:{runner,worker,common,matchers,reporters,index.ts}` | config, discovery, scheduling, worker processes, fixtures, expect, reporters, artifacts | verified_static + runtime |
| L7 | Agent tooling (already shipped) | `pwc:tools/{backend,cli-client,cli-daemon,mcp,skills,trace,dashboard}`, `pw:agents/*`, `pw:mcp/test/*` | MCP/CLI browser tools, snapshot/verify/codegen tools, planner/generator/healer agent definitions | verified_static (E-020..E-024) |

**REA-derived boundary check (E-001, verified_static):** across the 331 files REA parsed in `playwright-core/src`, there is **no import from `client/` to `server/`** (and `client → @protocol` has 15 edges); `remote → server` has 21 and `server → generated` 26. The client/server split is therefore enforced structurally, communicating only through the generated protocol types. Derived matrix: `research/rea-evidence/derived/dir-import-matrix.json`.

## 3. Key architectural decisions and why they matter for agents

1. **Everything is deadline-scoped via `Progress`** (`pwc:server/progress.ts:30-209`). `ProgressController.run()` installs a timeout timer (`:134-143`), exposes `progress.race()` which races every awaited operation against a force-abort promise (`:107-123`), and accumulates `metadata.log` (the "Call log"). Timeouts therefore **cancel in-flight work at the next await** rather than merely rejecting a promise. Client-side `AbortSignal` is forwarded as an `__abort__` message (`pwc:client/connection.ts:206-215`, `pwc:server/dispatchers/dispatcher.ts` abort branch).
2. **Auto-waiting lives in the server, not the client.** One `click` = one RPC; the server loops (`frames.ts:1143-1195`, `dom.ts:330-383`). Round trips for retries are zero; this is why Playwright is cheap per action and a hard baseline for agent loops.
3. **Actionability is computed in-page.** `inj:injectedScript.ts:699-785` (`checkElementStates`, rAF-based `_checkElementIsStable`) and a hit-target interceptor (`:1033`, `:1149`) evaluate visibility/enabled/stable/receives-events in the page's own frame clock.
4. **The error is a first-class product.** The call log is compressed (`pwc:server/callLog.ts:17`, used `server/page.ts:805`, `dispatcher.ts` response path) and shipped with the error (`client/connection.ts:244-258`). Runtime check shows output such as `<div id="ov"></div> intercepts pointer events` (E-040, verified_runtime).
5. **Instrumentation is a listener bus.** `SdkObject.instrumentation` (`pwc:server/instrumentation.ts`) calls `onBeforeCall/onAfterCall/onBeforeInputAction` around *every* dispatched call (`dispatcher.ts` dispatch body, with 3 s tolerance windows). Tracing, HAR, inspector/recorder and the test runner's step reporting all hang off this bus (E-009).
6. **Agent surface is built *from* the same primitives, not beside them.** `tools/backend/*` calls public `Locator`/`Page` APIs (`snapshot.ts:80-104`), requests `ariaSnapshot({mode:'ai'})` (`tab.ts:461-475`), echoes the executed action as generated Playwright code (`response.ts:282-285`), and ships `testing`-capability verification tools (`verify.ts`).

## 4. What is NOT in the engine (relevant to the gap analysis)

* No semantic "intent → postcondition" action contract: actions return `void`/`done` (e.g. `client/locator.ts:122`), success = no exception.
* No built-in notion of a *recovery attempt* distinct from retry: retries are deterministic polling of the same operation (backoff `[20,50,100,100,500]` in `frames.ts:1144`; `[0,20,100,100,500]` in `dom.ts:333`). The only adaptive mechanism is user-registered `addLocatorHandler` (`pwc:server/page.ts:529-600`).
* The agent-facing MCP/CLI tools (L7) have **no independent verifier layer**: `verify_*` tools are existence/visibility checks done through the same page handle.
* Replay is trace-*viewing*, not re-execution: the trace is a recording (`context-options`, `before`/`after` events, snapshots, screenshots, `aria-snapshot` events - `pwc:server/trace/recorder/tracing.ts:509-598`); no code path re-drives a browser from it (not found; see Q4).

Detailed component, execution, runner, observability and extension write-ups follow in the sibling files.
