# Playwright execution model

Pinned: `microsoft/playwright@b335271c`. Prefixes as in `playwright-architecture.md`.

## 1. Call lifecycle (one public API call)

1. **Client zone** (`pwc:client/channelOwner.ts:189-225`): `_wrapApiCall` captures the library stack/API name and opens an `apiZone`; nested calls inside the zone are marked internal so only the outermost call is reported/traced (`:156-175`).
2. **Send** (`pwc:client/connection.ts:179-221`): builds `{id, guid, method, params}` plus `metadata{title, location, internal, timeout}`; exits the zone (`emptyZone.run`) so server events are not attributed to the call; if an `AbortSignal` is supplied, an abort listener posts `__abort__{id}` (`:206-215`).
3. **Server dispatch** (`pwc:server/dispatchers/dispatcher.ts` `dispatch`): validates params and metadata against the generated schema, creates a `CallMetadata`, registers a `ProgressController` per call id (so `__abort__` can find it), runs `instrumentation.onBeforeCall` under a 3 s budget, runs the method with `controller.run(fn, metadata.timeout)`, serialises result or `serializeError`, attaches `compressCallLog(callMetadata.log)` on error, runs `onAfterCall` (3 s budget), applies `slowMo`.
4. **Reply** (`client/connection.ts:235-262`): resolves/rejects the pending callback; on error appends `formatCallLog(log)` to the message and validates structured `errorDetails`.
5. **Events** flow the other way as `__create__/__adopt__/__dispose__` object lifecycle messages and normal events (`client/connection.ts:266-296`).

A timeout of `0` means "no timeout" (`progress.ts:134 if (deadline)`), while `progress.wait(0)` means "no wait" (`progress.ts:114-118` comment).

## 2. Cancellation and timeouts

* **Deadline timer** rejects `_forceAbortPromise` and aborts the `AbortController` when `monotonicTime()` passes `deadline` (`progress.ts:134-149`); `pauseStartTime` (debugger pause) suspends it.
* **`progress.race()`** wraps every awaited sub-operation (`Promise.race([...promises, forceAbort])`), so abort is observed at the next await boundary. Work that must be undone on abort uses `raceUncancellableOperationWithCleanup` (`progress.ts:192-206`).
* **Error classes:** `TimeoutError` (`server/errors.ts:32`), abort errors tagged by `kAbortErrorSymbol`, `isAbortError` (`progress.ts:189`), `TargetClosedError` (`errors.ts:36`), `NavigationAbortedError` (`frames.ts:91`), `ExpectError` (`frames.ts:107`).
* **Non-retriable set** (`frames.ts:1182-1196`): abort/timeout, JS errors in evaluate, closed session, non-recoverable DOM errors, invalid selectors, detached frame. **Everything else is retried** until the deadline.

## 3. The shared retry primitive

`Frame.retryWithProgressAndBackoff` (`frames.ts:1143`) → `retryWithProgressAndTimeouts` (`:1153`). Poll delays are `[0, 20, 50, 100, 100, 500]` ms, with large values popped when `progress.timeout/5` is smaller (so tiny timeouts still poll). Each wait is raced against `page.openScope` and `frame._detachedScope`, so page close/frame detach interrupts immediately. Used by: actions (`_retryWithProgressIfNotConnected`, `:1197`), `expect` (`:1505`), `waitForSelector` (`:850`), `waitForFunction` (fixed 100 ms: `:1615`), and a few others (`:1765`). `ElementHandle._retryAction` (`dom.ts:330`) adds a second, inner loop with waits `[0,20,100,100,500]` for actionability misses.

## 4. Actionability sequence for pointer actions

`dom.ts:402-533` (`_performPointerAction`), in order: best-effort scroll for iframes → `checkElementStates(['visible','enabled','stable','non-inert'])` in-page (`inj:injectedScript.ts:699`) → scroll into view (protocol scroll, cycling `{end,end}`/`center`/`start` alignments across retries `dom.ts:385-398`) → compute clickable point → `onBeforeInputAction` (trace hook) → `_checkFrameIsHitTarget` and install a **hit-target interceptor** in the page that verifies the real event target equals the element (`inj:1149`) → perform input under `waitForSignalsCreatedBy` (waits for scheduled navigations) → stop interceptor. Misses return a string/struct (`error:notvisible`, `{hitTargetDescription}`, `{missingState}`) that `_retryAction` logs and loops on (`dom.ts:343-374`). `force:true` skips the checks; `trial:true` runs them without the action.

Before any action or expect, `Page.performActionPreChecks` (`server/page.ts:547-552`) waits for a pending main-frame navigation and runs **locator handlers** (user-registered "if this overlay appears, run this callback") at a checkpoint.

## 5. Expect (web-first assertion)

Client `expect(locator).toX()` → matcher in `pw:matchers` → `frame.expect` RPC → server `Frame.expect` (`frames.ts:1475`): (1) action pre-checks, (2) **one-shot** evaluation with a null progress that always completes, so `{timeout:1}` still passes on an already-true state (`:1496-1503` comment), (3) backoff polling to the deadline. On failure `ExpectError` carries last `received` value, a `timedOut` flag and, when the element was not found, an **ARIA snapshot of the body** (`_expectInternal` `:1592-1599`, via `inj:ariaSnapshotForExpectFailure` `:346`). The call log lines (`locator resolved to`, `unexpected value`) are produced here (`:1535-1537`, `:1604`).

## 6. Process and concurrency model

* Client↔server can be in-process (`pwc:inprocess.ts`), out-of-process (`outofprocess.ts`) or remote (`pwc:remote/*`); the client never imports the server (E-001).
* Browser: separate OS process spawned by `launchProcess` with SIGINT/SIGTERM/SIGHUP handlers and graceful-close-then-kill (`server/browserType.ts:199-285`).
* Test runner: one **main process** (scheduler/reporters) + N **worker processes** each running a client + (in-process) server against its own browsers (see `playwright-test-runner.md`).

## 7. Asynchrony hazards visible in the code (candidate sources of flake)

* `Frame.goto` collects `InternalNavigation` events *before* awaiting `navigateFrame` so a fast commit is not missed (`frames.ts:716-731`) - evidence that navigation races are real.
* Stability is measured with `requestAnimationFrame` and drops sub-15 ms frames (WebKit Windows workaround, `inj:726-729`).
* `compressCallLog` dedupes repeated retry blocks (`callLog.ts:17`), which hides per-attempt timing from the final message (hypothesis: per-attempt data exists in `metadata.log` but is collapsed before reaching the client).

Verification status: all of §1-§5 `verified_static`; the backoff pattern `20/100/500` and the hit-target message were additionally observed at `verified_runtime` on 1.64.1 (E-040, E-041).
