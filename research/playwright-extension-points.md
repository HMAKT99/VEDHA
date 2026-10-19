# Playwright extension points

Pinned: `microsoft/playwright@b335271c`. "Reuse" = what Vedha can build on without forking Playwright.

| Extension point | Mechanism (evidence) | Reach | Reuse assessment |
|---|---|---|---|
| **Client instrumentation** | `_instrumentation.onApiCallBegin/End`, `runBeforeCreateBrowserContext/runAfterCreateBrowserContext/runBeforeCloseBrowserContext` (`pwc:client/channelOwner.ts:156-175`, `client/browserType.ts:75,112`, `pw:index.ts:151-177`) | wraps every public API call, context lifecycle | The runner itself uses it for artifacts; internal API (`_instrumentation`), not documented as public (I) |
| **Custom fixtures** | `test.extend`, `mergeTests` (`pw:common/testType.ts:68,316,335`), fixture options `scope/auto/option/timeout/box` (`pw:common/fixtures.ts:29`) | everything in the test lifecycle | Public, stable; primary seam for an agent-aware test mode |
| **Config** | `defineConfig`, projects with dependencies, `globalSetup`, `webServer`, `use` options (`pw:common/config.ts`) | scheduling/environments | Public |
| **Custom reporters** | `reporter` config; ReporterV2 / `teleEmitter.ts`, `multiplexer.ts` (`pw:reporters/*`) | all runner events (steps, attachments, errors) | Public; good place to emit structured agent traces without touching the runner |
| **Custom selector engines** | `selectors.register(name, script)` (`pwc:client/selectors.ts:31`); `testIdAttribute` (`server/selectors.ts:53`) | locator syntax | Public |
| **Locator handlers** | `page.addLocatorHandler` (`pwc:server/page.ts:529-600`) | user-defined overlay/interstitial handling at the action checkpoint | Public; the only built-in "recovery" hook; always runs user code, cannot be conditioned on a diagnosis |
| **Network** | `route`/`routeFromHAR`/`routeWebSocket`, request interceptors (`server/network.ts:386-480`, `browserContext.ts:95,505`) | request-level determinism and fault injection | Public; key to deterministic replay |
| **Clock** | `server/clock.ts` / `inj:clock.ts` | time determinism | Public (name-level verification only) |
| **Connect/CDP** | `connect`, `connectOverCDP` (incl. transport object) (`pwc:client/browserType.ts:121-171`) | attach to external browsers, custom transports | Public; lets Vedha own the browser lifecycle |
| **MCP / CLI backend** | `pwc:tools/index.ts`, `tools/backend/*` tool registry (`defineTabTool`, capabilities `core`/`testing`...), config `snapshot.mode`, `codegen`, `secrets`, `snapshot.boxes` (`response.ts:160-168,284`) | agent tool surface | Can be embedded or re-served; capability gating is a good pattern |
| **Agent definitions** | `npx playwright init-agents` code in `pw:agents/generateAgents.ts` and prompt files (`*.agent.md`) | planner / generator / healer role prompts | Reference material; prompt-level, not a runtime protocol (I) |
| **Plugins** | `pw:plugins/{index,webServerPlugin,gitCommitInfoPlugin}.ts` | runner task pipeline | Internal task plugins (I for external use) |
| **Babel/TS transform** | `pw:transform/*` | test code loading | Internal |
| **Code generation** | `@isomorphic/codegen/*` language generators; `tools/backend/codegen.ts:renderCode` (typescript/python/java/csharp) | turn recorded actions into test code | Directly usable concept for "exploration → regression test" (E-024) |
| **Protocol** | `packages/protocol` (schema → validators, channels) | typed wire API; metainfo `internal`/`slowMo` flags (`dispatcher.ts` `getMetainfo`) | A stable, schema-validated boundary; good compatibility target |

## Not extension points (closed)
Internal `Progress`, `Frame` retry internals and the injected script have no override hooks; changing actionability or retry policy requires forking (I; no config key found for the backoff arrays at `frames.ts:1144` / `dom.ts:333`).

## Design implication
Vedha can add agent-first behaviour **above** Playwright through public seams (fixtures, reporters, route, locator handlers, connect/CDP, MCP-style tools) and does not need to fork the server. Policies that live inside `Progress`/`Frame` (retry timing, per-attempt logging) are the only places where Playwright cannot be configured and would have to be re-implemented or observed from outside.
