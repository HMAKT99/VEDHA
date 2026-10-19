# Playwright execution traces (6 scenarios)

Pinned: `microsoft/playwright@b335271c` (static) and `playwright@1.64.1` (runtime; see Q1). Each step lists source `file:line`, and a **verification tag**: `S` static-read, `R` runtime-observed (experiment files under `research/experiments/pw-runtime/`), `I` inferred. REA role per scenario is stated honestly: REA supplied the module/import/event/function inventories and boundary checks; it could **not** resolve `this.method()` call edges (L-05), so call ordering was established by reading source, then confirmed at runtime where noted.

---
## T1 - Browser launch and context creation

Entry: `chromium.launch()` → `pwc:client/browserType.ts:66`.
1. `@apiCall` zone opens (`channelOwner.ts:189`). Asserts no `userDataDir`/`port` (`:67-68`), merges `_defaultLaunchOptions`, converts env to array (`:72-78`). **S**
2. `this._channel.launch(params, launchTimeout)` → RPC (`connection.ts:179`). **S**
3. Server `BrowserType.launch(progress, options)` (`pwc:server/browserType.ts:67`): `_validateLaunchOptions`; Selenium hub shortcut; `_innerLaunchWithRetries` (`:95-107`: single retry on glibc `ld.so` race, logs `<restarting browser due to hitting race condition in glibc>`). **S**
4. `_innerLaunch` (`:109-148`) → `_launchProcess` (`:199-285`): `_prepareToLaunch` (`:150-197`) builds executable + args; `launchProcess({...})` spawns with `stdio:'pipe'`, signal handlers, `attemptToGracefullyClose`, `onExit` resolving an `exitPromise` (unblocks launch on premature exit); builds `browserProcess{close: closeOrKill, kill}`. **S**
5. `connectToTransport` → `chromium.ts:212` creates `CRBrowser` over a `CRConnection` (`crConnection.ts`: sessionId-multiplexed `CRSession`s; `Target.attachedToTarget` creates child sessions). **S/I** (CDP handshake details not stepped).
6. On failure `browserProcess.close()` is called (`browserType.ts:145-147`). **S**
7. Client wraps result: `Browser.from(...)`, `browser._connectToBrowserType` (`client/browserType.ts:79-80`). **S**
8. `browser.newContext()` → client `browser.ts:63-86` → server `Browser.newContext` (`server/browser.ts:107-128`): validate options → `doCreateNewContext` (`crBrowser.ts:118`) → `context.setStorageState` → emit `Browser.Events.Context`; on error the context is closed with reason `'Failed to create context'`. **S**
9. **R:** launch of headless Chromium measured 1,515 ms wall in our run (`exp1-output.json` `launchMs`, includes cold start; single sample - not a benchmark).

Tests: `tests/library/browsertype-launch.spec.ts`, `browsertype-basic.spec.ts`, `browser.spec.ts`, `browsercontext-basic.spec.ts`, `browsercontext-reuse.spec.ts`.
Uncertain: CDP bootstrap (`Target.setAutoAttach`, etc.) not stepped (I).

---
## T2 - Navigation (`page.goto`)

Entry: `Page.goto` (client) → `Frame.goto` RPC → `pwc:server/frames.ts:692`.
1. `constructURLBasedOnBaseURL(context.baseURL, url)` (`:693`); `raceNavigationAction` wraps the impl. **S**
2. `gotoImpl` (`:697`): verify `waitUntil` (default `load`); log `navigating to "<url>", waiting until "<state>"`; merge `referer` from extra headers; install a collector on `Frame.Events.InternalNavigation` **before** the protocol call (`:711-716`). **S**
3. `await progress.race(delegate.navigateFrame(frame, url, referer))` returns `{newDocumentId?}` (`:718`). **S**
4. If `newDocumentId`: pick the first collected navigation event for that document (or any later committed one), else wait for it (`:721-738`); a different document id → `NavigationAbortedError` "interrupted by another navigation" (`:735`); `event.error` rethrown. If no new document (same-document nav) wait for a non-document event (`:743-751`). **S**
5. If lifecycle `waitUntil` not yet in `_firedLifecycleEvents`, wait for `AddLifecycle` (`:753`). **S**
6. Return `request._finalRequest().response(progress)` (`:756-757`). **S**
7. Lifecycle bookkeeping is reset by `_onClearLifecycle` (`:575`, called `:267`, `:971`). **S**

State transitions: `pendingDocument` → committed `currentDocument`; lifecycle set `{commit, domcontentloaded, load, networkidle}` cleared on new document.
Cross-process: Node server ⇄ browser via CDP (`Page.navigate` through delegate) **I** (not read in `crPage.ts` for this scenario).
Tests: `tests/page/page-goto.spec.ts`, `frame-goto.spec.ts`, `page-wait-for-navigation.spec.ts`, `page-wait-for-load-state.spec.ts`, `page-click-during-navigation.spec.ts`.

---
## T3 - Locator resolution and a real interaction (`locator.click`)

Entry: `Locator.click` `pwc:client/locator.ts:122` → `Frame.click` (client `frame.ts:321`) → RPC `frame.click` → `FrameDispatcher.click` (`server/dispatchers/frameDispatcher.ts:146`) → `Frame.click` (`frames.ts:1256`).
1. `_retryWithProgressIfNotConnected(progress, target, {force, waitForFrameVisible:true}, action)` (`:1197`): log `waiting for <locator>` (`:1204`). **S, R** (`- waiting for getByRole('button', { name: 'Save' })`)
2. Loop via `retryWithProgressAndBackoff`: `performActionPreChecks` (`page.ts:547`) then `selectors.callOnSelectorHandle({markTargets:'all'})` evaluates the selector **in-page**, returning element + bounding box and a log line `locator resolved to <button ...>` (`:1209-1219`). **S, R**
3. If >1 element and strict → strict-mode error path elsewhere; here logs `Proceeding with the first one` for non-strict (`:1212`). **S**
4. `action(progress, handle, box, frameVisible)` = `handle._click(...)` → `_retryPointerAction` (`dom.ts:385`) → `_retryAction` loop (`:330`) → `_performPointerAction` (`:402`) sequence from execution model §4. **S, R**
5. `'error:notconnected'` from any step → `element was detached from the DOM, retrying` and `continuePolling` (`frames.ts:1237-1240`). **S**
6. Success returns `'done'`; `dom.assertDone` (`frames.ts:1257`).

**R (E-040):** with a `position:fixed` overlay present, call log showed: `locator resolved to <button …>` → `attempting click action` → `2 × waiting for element to be visible, enabled and stable` → `element is visible, enabled and stable` → `scrolling into view if needed` → `done scrolling` → `<div id="ov"></div> intercepts pointer events` → `retrying click action` → `waiting 20ms` → … `waiting 100ms` → … `waiting 500ms`. This reproduces the static order exactly. After removing the overlay the same click succeeded (`exp1.mjs`).
Tests: `tests/page/locator-click.spec.ts`, `elementhandle-click.spec.ts`, `tests/library/hit-target.spec.ts`, `tests/page/page-click-scroll.spec.ts`, `retarget.spec.ts`.

---
## T4 - Waiting for a dynamic UI transition

Two mechanisms, both on the shared retry primitive:
**(a) `locator.waitFor` / `waitForSelector`** → `Frame.waitForSelector` → `retryWithProgressAndBackoff` (`frames.ts:850`). **S**
**(b) web-first `expect`** → `Frame.expect` (`frames.ts:1475`): pre-check → one-shot → polling (`:1505`) until `matches !== isNot`, else `continuePolling`. **S**
* Experiment (**R**): button click schedules a 300 ms DOM insert; `page.locator('#done').waitFor({timeout:3000})` resolved and `innerText()` returned `"Saved"` (`exp1-output.json`). The test-runner experiment shows the polling shape for a *non-matching* expect: `13 × locator resolved to <h1>Hello</h1> - unexpected value "Hello"` within a 1,200 ms budget (E-042).
* Waiting for navigation triggered by an action is built into actions: `waitForSignalsCreatedBy(progress, waitAfter, ...)` (`dom.ts:~497`), log `waiting for scheduled navigations to finish` / `navigations have finished`. **S**
* Locator handlers interleave here: overlay handlers run at the pre-check checkpoint and the action then waits for the overlay to be hidden (`page.ts:583-600`). **S**
Tests: `tests/page/page-wait-for-selector-1.spec.ts`, `-2.spec.ts`, `expect-timeout.spec.ts`, `page-add-locator-handler.spec.ts`, `tests/mcp/autowait.spec.ts`.

---
## T5 - Action timeout and assertion failure

**Action timeout path:** deadline timer fires → `_forceAbortPromise.reject(TimeoutError("Timeout 1000ms exceeded."))` (`progress.ts:134-149`) → racing awaits throw → `retryWithProgressAndTimeouts` catch sees `isNonRetriableError(TimeoutError)` → rethrow (`frames.ts:1169-1176`, `:1183`) → dispatcher catch: `serializeError`, `response.log = compressCallLog(callMetadata.log)` (`dispatcher.ts` response path) → client `parseError`, appends `formatCallLog` and sets `error.log` (`connection.ts:244-258`) → `_wrapApiCall` prefixes `locator.click:` and rewrites stack with user frames (`channelOwner.ts:208-221`). **S**
**R:** `locator.click: Timeout 1000ms exceeded.` + `- element is not enabled` ×N with the 20/100/500 ms waits (disabled button case) and the overlay case (E-040, E-043).

**Assertion path:** `Frame.expect` catch builds `ExpectErrorDetails{received, customErrorMessage, timedOut}` (`frames.ts:1519-1537`) → `ExpectError` → test-runner matcher formats `Locator/Expected/Received/Timeout/Call log` (observed at runtime). If the element was not found, the server first captures an ARIA snapshot (`:1592-1599`) that the runner stores in `error.errorContext` and later writes to `error-context.md`. **S, R**
**R (assertion):** `expect(heading).toHaveText('Goodbye',{timeout:1200})` → `Expected: "Goodbye" Received: "Hello" Timeout: 1200ms`, log `13 × locator resolved to <h1>Hello</h1>`.
Tests: `tests/page/expect-timeout.spec.ts`, `page-click-timeout-1..4.spec.ts`, `tests/playwright-test/timeout.spec.ts`, `expect.spec.ts`.

---
## T6 - Test failure processing and debugging artifacts

1. `WorkerMain._runTest` (`pw:worker/workerMain.ts:292`) creates `TestInfoImpl`, sets `timeoutManager.setTimeout(test.timeout)` (`:~313`), runs beforeEach/test body under `_runWithTimeout`. Timeout messages are composed per runnable type in `pw:worker/timeoutManager.ts:170-215` (e.g. `Test timeout of Nms exceeded.`, fixture setup/teardown variants). **S**
2. After the body, an `After Hooks` step (`workerMain.ts:~433-470`) runs: `_didFinishTestFunction` (screenshot capture), afterEach hooks, test-scoped fixture teardown with an **extra** timeout slot (`afterHooksSlot`, `:433-434`), afterAll for suites not shared with the next test. **S**
3. The built-in `_contextFactory`/artifacts fixture (`pw:index.ts`): `willCloseBrowserContext` → stop tracing chunk, capture temporary screenshot, and `_takePageSnapshot` which, **only when the test has errors and none carries errorContext**, calls `page.ariaSnapshot({mode:'ai', timeout:5000})` internally (`index.ts:765-790`). `didFinishTest` persists screenshots, then writes `error-context.md` using `buildErrorContext` (`index.ts:822-840`, `pw:errorContext.ts:24-86`) and attaches it (`contentType: text/markdown`). **S**
4. Trace: `Tracing` records `before/after` call events, DOM snapshots, ARIA snapshots, screenshots, screencast; `stopChunk` zips (`pwc:server/trace/recorder/tracing.ts:414-475`). **S**
5. Failure result is sent main-process-ward via `testEnd` IPC; main `Dispatcher` decides retries (`pw:runner/dispatcher.ts:546-620`) and reporters print attachments. **S/I** (IPC message names not individually traced).

**R (E-044):** running two failing tests with `trace:'on', screenshot:'only-on-failure'` produced per test: `trace.zip`, `test-failed-1.png`, `error-context.md`. `error-context.md` content = fixed "Following Playwright test failed…" instruction block + test info + error + (for matcher failures) the ARIA YAML of the failing locator + code frame with the failing line marked. `trace.zip` contained `0-trace.trace`, `1-trace.trace`, `test.trace`, `*.network`, `*.stacks`, `screencast/`, `src/`, `attachments/`; the first file's first event is `context-options` (`version:10`, `playwrightVersion:"1.64.1"`).
Tests: `tests/playwright-test/playwright.trace.spec.ts`, `reporter-attachment.spec.ts`, `reporter-html.spec.ts`, `timeout.spec.ts`, `retry.spec.ts`, `tests/library/trace-viewer.spec.ts`.

---
## Steps still inferred (not verified)
* CDP bootstrap and `crPage` navigation command specifics (T1.5, T2).
* Main↔worker IPC message sequence (T6.5).
* Exact semantics of `waitForSignalsCreatedBy` (read only by name/log lines).
* Firefox/WebKit/BiDi behaviours of any scenario (only Chromium run).
