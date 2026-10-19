# Playwright observability, tracing and debugging artifacts

Pinned: `microsoft/playwright@b335271c`; runtime on `playwright@1.64.1`.

## 1. Signals produced

| Signal | Producer | Where it surfaces | Status |
|---|---|---|---|
| **Call log** (human-readable step narration with repeated-block compression) | `Progress.log` → `metadata.log` (`pwc:server/progress.ts:97-104`); `compressCallLog` (`server/callLog.ts:17`) | error message suffix; `error.log` on the client (`client/connection.ts:244-258`) | S, R |
| **API call events** (before/after with params, stack, result/error) | `Instrumentation.onBeforeCall/onAfterCall` | trace, test steps, reporters | S |
| **Trace** (`trace.zip`: NDJSON events, DOM snapshots (before/action/after), screenshots, `aria-snapshot` events, screencast frames, network, stacks, source) | `pwc:server/trace/recorder/tracing.ts` (+`snapshotter.ts`) | `npx playwright show-trace`, UI mode, and agent trace CLI `pwc:tools/trace/*` | S, R (zip contents inspected) |
| **Test steps & attachments** | `TestInfoImpl._runAsStep`, `attach` (`pw:worker/testInfo.ts:325,510`) | reporters (HTML/JSON/JUnit...) | S |
| **Screenshots/video** on failure | `SnapshotRecorder` in `pw:index.ts:~641-710`; `videoRecorder.ts`, `screencast.ts` | attachments | S, R (png) |
| **`error-context.md`** (LLM-oriented failure brief) | `pw:errorContext.ts`, `pw:index.ts:765-840` | attachment `error-context` | S, R |
| **Console / page errors / network / dialogs** as events | `server/console.ts`, `network.ts`, `dialog.ts` | `page.on(...)`; MCP `browser_console_messages`, `browser_network_requests` | S |
| **ARIA snapshot (`mode:'ai'`)** with stable `[ref=eN]` ids | `inj:ariaSnapshot.ts`, `injectedScript.ts:330-343` | `page.ariaSnapshot`, MCP `browser_snapshot`, error context | S, R |
| **Perfetto timeline reporter** | `pw:reporters/perfetto.ts` | file | S (existence) |

## 2. Trace internals (verified_static + runtime)

* Recorder is an instrumentation listener: `onBeforeCall` appends a `before` event *synchronously* ("no awaits", `tracing.ts:577-586`) then captures a "before" DOM snapshot; `onBeforeInputAction` records click point/box (`:589-598`); after-call captures an "after" snapshot; ARIA snapshots (`:574`) and screenshots (`:563`) are separate events keyed by `callId`.
* Format: `context-options` first (version 10, browserName, playwrightVersion, platform, wallTime, monotonicTime, sdkLanguage, title) - read from the produced `0-trace.trace` (runtime).
* Zip layout produced by a 2-test run: `0-trace.trace`, `1-trace.trace`, `*.network`, `*.stacks`, `test.trace` (runner-side steps), `screencast/`, `src/`, `attachments/`.
* Our extraction of per-action events from the sample: `0-trace.trace` was 263 bytes (context-options only) and `1-trace.trace` 7,642 bytes, so the first chunk in this layout belongs to the (empty) pre-test context. Details of event schema beyond `context-options` were not enumerated from the sample (only a count of event `"type"` values in the first file was attempted) - see Q5.

## 3. Agent-oriented observability already shipped (important for gap analysis)

* `error-context.md`: fixed prompt + test identity + error + ARIA YAML + code frame (`pw:errorContext.ts:24-86`, observed output in `research/experiments/pw-runtime/test-results/*/error-context.md`).
* `pwc:tools/trace/*` (`traceActions.ts`, `traceErrors.ts`, `traceSnapshot.ts`, `traceRequests.ts`, `traceConsole.ts`, `traceScreenshot.ts`, `traceParser.ts`, `traceOpen.ts`, `traceCli.ts`) and skill `tools/skills/playwright-trace` - a CLI for reading traces from the terminal. **Run on the sample trace (E-070):** `playwright trace open <zip>` then `actions` (1,688 B: numbered rows with timings, failing row marked ✗) and `errors` (742 B incl. full call log); other subcommands: `action`, `requests`, `request`, `console`, `snapshot`, `screenshot`, `attachments`, `install-skill`. Trace NDJSON types observed: `before/after/log/frame-snapshot/screencast-frame/event/error/context-options` (E-071).
* `tools/backend/response.ts` emits sections `### Ran Playwright code`, page snapshot, tab headers, console/errors, and can write snapshots to files (`:208`, `:282-317`).
* `tools/backend/sessionLog.ts`, `logFile.ts` exist (names only; Q7).

## 4. What is not observable (hypotheses to test in Phase 3)

* **Per-attempt retry detail** is collapsed by `compressCallLog` before leaving the server (`callLog.ts:17`). Hypothesis: an agent diagnosing flakiness cannot distinguish "10 identical misses" from "1 miss then slow success" beyond the `N ×` prefix and wait lines. (I; call log runtime output shows `2 × waiting…` groups, consistent.)
* **No outcome record**: a successful action logs `done` but not "what changed" (DOM/URL/network diff) - the agent tools compensate by re-snapshotting (`response.setIncludeSnapshot()` `snapshot.ts:75`).
* **No cross-run determinism metadata** (seed, clock, network mode) in the trace besides `context-options`; replay of the *environment* is manual (HAR via `routeFromHAR`/`har/*`, `clock.ts`).
* **Trace is a recording, not a program**: no re-execution entry point found in the files read (Q4, E-073: the `trace` CLI has no replay subcommand).
