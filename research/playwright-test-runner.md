# Playwright test runner (`packages/playwright`)

Pinned: `microsoft/playwright@b335271c`; `pw:` = `packages/playwright/src`. Strengths are called out because the new framework must preserve them (Phase 1.3).

## Structure
* **Config** (`pw:common/config.ts`): `FullConfigInternal`; defaults `workers:'50%'`, `fullyParallel:false`, `maxFailures:0`, `forbidOnly:false` (`:94-114`); projects resolved with dependencies (`resolveProjectDependencies` `:139`); global setups and `webServer` plugins (`:55`, `:74`, `:124`, `pw:plugins/webServerPlugin.ts`).
* **Discovery/loading** (`pw:runner/loadUtils.ts`, `loaderHost.ts`, `pw:transform/*` TypeScript/ESM transform): tests are loaded in a loader process, building `Suite`/`TestCase` trees (`pw:common/test.ts`).
* **Task pipeline** (`pw:runner/tasks.ts`, `taskRunner.ts`): ordered tasks (plugins/global setup → load → create test groups → run).
* **Test groups & sharding** (`pw:runner/testGroups.ts`): tests grouped by `workerHash` (a hash of fixtures/options that determines worker compatibility, `:22`, `:39-72`); `filterForShard(shard, weights, groups)` (`:151-175`) shards at *group* level - parallel files shard per test, serial files shard whole-file; supports `PWTEST_SHARD_WEIGHTS`.
* **Scheduler** (`pw:runner/dispatcher.ts`): `_scheduleJob` (`:102-140`) is deliberately synchronous: find job → prefer a worker slot whose `hash()` equals the job's `workerHash` (worker reuse keeps expensive worker fixtures) else any free slot → claim → run async. `_isWorkerRedundant` (`:213`) retires workers when no remaining job needs that hash. After failures it builds `retryCandidates` (including whole failed `serial` suites, `:546-577`) and applies a `retryStrategy` (`'immediate'` re-queues at once, `:585`). `maxFailures` stops via the `JobDispatcher` callback (`:116`).
* **Worker** (`pw:worker/workerMain.ts`): runs in a child process (`workerProcessEntry.ts`); one `TestInfoImpl` per attempt (`:292`); IPC events `stepBegin/stepEnd/attach/testPaused` (`:293-301`); `FixtureRunner` (`pw:worker/fixtureRunner.ts`, 310 l) resolves dependency-ordered fixtures with scopes `test|worker`, `auto`, `option`, per-fixture `timeout`, `box` (`pw:common/fixtures.ts:29-54`).
* **TimeoutManager** (`pw:worker/timeoutManager.ts`): separate time slots per runnable (test body vs fixture with own timeout vs hooks), producing context-specific messages (`:170-215`); after-hooks get an additional slot (`workerMain.ts:433-434`).
* **Built-in fixtures** (`pw:index.ts`): `browser` (worker scope, `:238`), `context`/`page` per test (`:474`, `:494`) built on `_contextFactory` (`:400`), `baseURL`, `testIdAttribute` (`:83`), plus the instrumentation-driven `_setupArtifacts` (`:85`) that wires screenshots, traces, video, and `error-context.md`.
* **Expect** (`pw:matchers/expect.ts`): wraps `expect` with custom matchers (`toHaveText`... → `frame.expect` RPC), `expect.soft`, `expect.poll` (`:434-436`), `toPass` retry blocks (`:80,141,211`), `expect.configure`, aria snapshot matcher (`toMatchAriaSnapshot.ts`).
* **Reporters** (`pw:reporters/*`): list/line/dot/html/json/junit/github/blob/perfetto, `redactingReporter.ts` (secret redaction), `merge.ts` for sharded blob reports.
* **Other modes:** watch (`watchMode.ts`), UI mode (`uiModeReporter.ts`, `testServer.ts`), `lastRun.ts` (rerun failed), `vcs.ts` (changed-files filtering).

## Isolation guarantees (verified_static)
* Per test: new `BrowserContext` (+ page) from the worker's shared `browser` (`index.ts:400-500`). Contexts are the isolation unit (cookies/storage/cache); browser process is reused per worker.
* Failures that can poison a worker stop it (`_isStopped`, `workerMain.ts`), with afterAll hooks run before worker fixture teardown (`workerMain.ts:~455-470`); the dispatcher respawns workers (`dispatcher.ts:152-162`).

## What it does well (preserve)
1. **Worker-hash scheduling** gives parallel throughput without re-launching browsers (E-050).
2. **Fixture model** is the extension seam for everything else (auth state, data seeding, page objects).
3. **Per-runnable timeout accounting** produces diagnosable timeout messages.
4. **Retries are first-class** with per-attempt results and trace-on-first-retry style options (`trace:'on-first-retry'` is a config value; pattern observed by reading options; not executed).
5. **Sharding + blob merge** for CI.
6. **Failure artifacts are automatic** and already include an LLM-oriented prompt file (`error-context.md`) (E-044).

## Gaps observed relative to agent workloads (hypotheses, benchmarked in Phase 3/5)
* Retries re-run the *same* test; there is no concept of a *diagnosed* retry with a changed strategy (hypothesis).
* The runner assumes authored tests; planner/generator/healer live as separate agent definitions (`pw:agents/*`) outside the core run loop.

Tests: `tests/playwright-test/{shard,retry,timeout,fixtures,fixture-errors,expect*.spec,worker-index,reporter-*.spec}.ts` (existence verified by `ls`; **not executed**).
