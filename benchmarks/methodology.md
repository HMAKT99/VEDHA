# Benchmark methodology

Status: the first benchmark measures **framework semantics with scripted (non-LLM) actors**. It does not measure model capability, token cost or cost in dollars, and no claim here extends beyond the scenarios listed. Rationale: no model API key/budget was available (ADR-0006). Results live in `benchmarks/results/<run>/` (`trials.jsonl` raw, `results.md` analysis, `env.json`).

## 1. Question the benchmark answers

Given the _same task definition_ (a neutral list of `ActionSpec`s), how do different execution semantics behave on (a) healthy apps, (b) benign interface changes and transient faults, and (c) seeded product defects? The costly error is a **false pass**: reporting success when the real effect is absent or a defect exists. Secondary: duplicated side effects, honest failures, recovery masking defects.

## 2. Systems under test (drivers)

| id              | what it is                                                                                                                                                                                                                             | uses from the task spec                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `pw-trust`      | Playwright library; step succeeds if no exception. Models the semantics of an agent tool that reports the action result. No retries.                                                                                                   | op, target, value, timeout               |
| `pw-test`       | Playwright Test style: web-first UI assertions (text/value/state/url), `retries: 1` (whole test re-run in a fresh context; server state persists).                                                                                     | + UI postconditions                      |
| `pw-strong`     | What an expert Playwright author would write for the same task: UI assertions, `waitForResponse` + status/JSON assertions, `addLocatorHandler` for the known banner, `retries: 1`. No alternate locators, no read-back reconciliation. | + network postconditions, `dismiss` list |
| `pw-heal-naive` | Reference **policy** (not a named product): trust-return semantics + generic "heal": on action failure retry once with `force:true`. Included to measure how a masking recovery policy behaves.                                        | op, target, value                        |
| `vedha`         | `Session` from `@vedha/core` over the Playwright adapter: framework-verified postconditions, recorded bounded recovery, reconcile for mutating actions, policy.                                                                        | everything                               |

Cross-browser: a separate track runs `vedha` and `pw-strong` on Firefox and WebKit (`VEDHA_BROWSER=firefox|webkit`). Not benchmarked (and why): Playwright MCP / agent-browser / browser-use / Stagehand / Midscene end-to-end - the LLM-driven ones need a model key; Playwright MCP's observation size is compared in a separate scripted track (see §7). **No competitor product is represented by a driver in this run**; `pw-*` drivers are Playwright configurations chosen to isolate semantics. Any statement about browser-use, Stagehand etc. in this repository comes from source reading (`research/`), not from this benchmark.

## 3. Fairness rules

- All drivers receive identical `Scenario.steps`. Each uses only what its semantics support (table above). This is a _capability_ difference of the semantics, not a hidden advantage: the spec fields (`postconditions`, `altTargets`, `dismiss`, `reconcile`) exist because Vedha's model makes them first-class; an expert Playwright author can express some (done in `pw-strong`) but not all.
- Same browser (Chromium, headless, 1000×800), same default action timeout (5 s unless the step overrides), same fixture app, same per-trial seed.
- A fresh server and browser context per trial; the harness (not the driver) reads server-side truth afterward from `/__oracle`, which no driver references.
- Trial order is shuffled with a fixed seed (`12345`) and drivers are interleaved to avoid time-of-run bias. Concurrency 4 on one machine; latency numbers are therefore only comparable within a run.
- Drivers never see which variant is active; variants are encoded in the server, not in the spec.

## 4. Scenarios (synthetic app; `benchmarks/fixtures/shop.ts`, `scenarios/index.ts`)

| id                             | category      | kind   | what changes                                                                                     |
| ------------------------------ | ------------- | ------ | ------------------------------------------------------------------------------------------------ |
| S01 order-clean                | baseline      | effect | none                                                                                             |
| S02 order-slow-ui              | dynamic       | effect | success message after seeded 0.4-1.2 s delay                                                     |
| S03 order-cookie-banner        | interstitial  | effect | full-screen banner at 300 ms                                                                     |
| S04 order-renamed-button       | ui-change     | effect | button text changed, `data-testid` stable                                                        |
| S05 order-banner-and-rename    | ui-change     | effect | both                                                                                             |
| S06 defect-silent-500          | seeded-defect | defect | server 500, UI optimistic "Order placed"                                                         |
| S07 defect-wrong-quantity      | seeded-defect | defect | server stores qty+1, UI shows success                                                            |
| S08 defect-disabled-submit     | seeded-defect | defect | submit permanently disabled                                                                      |
| S09 transient-503              | transient     | effect | first POST fails 503 before committing                                                           |
| S10 commit-then-late-response  | transient     | effect | order commits, response arrives 6 s later (step timeout 2.5 s)                                   |
| S11 search-paginate-open       | navigation    | effect | none (search, page 2, open item)                                                                 |
| S12 login-then-order           | auth          | effect | order requires a signed-in session                                                               |
| S13 defect-session-invalidated | auth          | defect | session silently invalidated after login; order POST would return 401                            |
| S14 ambiguous-delete           | hazard        | defect | three identical "Delete" buttons; spec names no row; correct report is fail with nothing deleted |
| S15 delete-scoped-row          | hazard        | effect | delete Bob using a row-scoped target                                                             |

Coverage gaps versus the brief's workload list (still not built): multi-tab, responsive/visual interfaces, long-horizon workflows, unfamiliar-application exploration quality, real third-party sites. These are listed as future work in `IMPLEMENTATION_STATUS.md`; no conclusion about them is drawn.

## 4a. Run history and post-freeze changes (read this)

S12-S15 were written **after** Vedha was feature-complete for S01-S11 and were run **once, unmodified, against frozen framework code** (`results/vedha-n20-frozen`, 1,500 trials). That run exposed two framework weaknesses, which were then fixed and the whole suite re-run (`results/vedha-n20-postfix`):

1. **Label substring matching** (S13): the check for the "Name" label also matched the login page's "Username" label (Playwright's default). `label`/`text` targets now accept `exact`; scenario specs and all drivers use `exact: true` for labels.
2. **Unverified input steps** (S12): a `fill` without a postcondition left the run `unverified` (Vedha reported _uncertain_ in 20/20 trials while the baselines claimed pass). `fill` and `check` now get a derived read-back check (values are never echoed into reports). `select` is excluded because option label and value can differ.

Because these fixes were prompted by the new scenarios, **S12 and S13 are no longer hold-out for the post-fix numbers**; the frozen-run numbers are the honest hold-out result. Both runs are kept. The earlier S01-S11-only run is archived in `results/archive/` (it predates the rename; driver id `agentfirst`).

## 4b. Selenium baselines, held-out widget families and the minimal-declarations track

Added after `preregistration.md` (read its amendments A1-A3 for what was seen before the freeze).

| id           | what it is                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sel-trust`  | Selenium WebDriver (Chrome), 5 s implicit wait, no assertions; success = no exception. Counterpart of `pw-trust`.                                                                                                                                                                                                                                      |
| `sel-strong` | What an expert Selenium author writes: explicit waits (visible and enabled), UI assertions with waits, fetch instrumentation for response assertions (WebDriver has no first-class one), a read-only HTTP state probe, known-banner dismissal, prompts accepted, JS-dispatched drag events, one whole-test retry. No alternate locators, no read-back. |

Selenium drivers are opt-in (`--drivers sel-trust,sel-strong`) and need a local Chrome; they are Chromium-only.

**Driver capability matrix** (which declared check kinds a driver acts on): `pw-trust`/`sel-trust` none; `pw-test` text, value, state, url (plus dialogs accepted when the scenario says so); `pw-strong`/`sel-strong` those plus response checks (status, JSON), read-only state probes and known-interstitial handling; `vedha` every kind, plus implicit read-back for fill/check, the page-health check, recovery, reconcile and the repeat guard. Giving the strong baselines state probes is deliberate: it is the generous reading of "expert", so a Vedha advantage cannot come from withholding a technique.

**Held-out widget families** (`fixtures/widgets.ts`, `scenarios/widgets.ts`, `--set held-out`): W01-W10 healthy (hover menu, double click, uncheck, upload, scroll-triggered load, drag and drop, confirm dialog, popup tab, iframe form, history back) and seven defect variants. Every effect is recorded in a server-side event log that only the harness reads. Defect variants make the server either answer 200 and record nothing (`silent`) or answer 500 (`error`) while the page shows success.

**Minimal declarations** (`--set held-out-minimal`): the same scenarios with only text and url checks. This is the realistic case for checks written by a novice or an LLM. By design, only a framework with its own page-health check can catch a rejected write here; nothing can catch a silent drop without a state probe, and those cells are expected to read as missed for every driver.

## 4c. LLM tracks (`benchmarks/llm/`)

- Pilots 1 and 2 use a custom adapter written by this project's author around one model; they are a record of a failed first design, not a comparison of products (see `llm/README.md`).
- Pilot 3 and later are **MCP vs MCP**: `@playwright/mcp` and `@vedha/mcp` are launched as stdio servers; the same model, system prompt, tool-result cap and turn limit drive both; the model ends with `RESULT: success|failure`, classified against server-side truth. Model: `minimax/minimax-m3.1-flash` through Vercel AI Gateway, provider pinned, temperature 0, free window and a $1 budget cap; the run aborts on any non-zero reported cost.
- Each run's `env.json` records the git commit; `packages/` is not rebuilt while a run is in progress (each trial spawns the server from `dist`).

## 5. Oracles and metric definitions

Truth is the server-side state (`OracleState`): orders, viewed items, POST count.

- `effect` scenario: intended effect achieved = exactly one order with name Ada and qty 3 (S11: item 29 viewed).
- `defect` scenario: the correct report is **fail**.
- Driver claim ∈ {pass, fail, uncertain}. Outcome classes (`harness/classify.ts`): `success`, `false_pass`, `false_fail`, `honest_fail` (reported fail and effect absent), `detected`, `missed`, `uncertain_*`, `driver_error`.
- **Correct** = `success` or `detected`. **False pass** = `false_pass` or `missed`.
- Duplicates = orders beyond the first. Masked defect = defect scenario where the driver passed after at least one recovery action.
- Latency = wall-clock per trial (driver run only), median and p95. Browser actions = Playwright action attempts counted by the driver.
- Not measured in this run: tokens, model calls, dollar cost, diagnostic quality (human-rated), setup/maintenance effort, cross-browser behaviour.

## 6. Statistics

n = 20 trials per (scenario, driver). Rates are reported with 95% Wilson intervals; paired comparisons use trial-index matching and an exact two-sided sign test on discordant pairs. Fixtures are deterministic except for seeded delays, so most trials within a cell agree; the effective sample for "does the behaviour vary" is small and intervals mainly bound _reliability_, not population-level generalisation. No multiple-comparison correction. Treat p-values as descriptive.

## 7. Threats to validity (read before citing numbers)

1. **Synthetic, author-built fixtures and author-built baselines.** Vedha's design drove the scenario choice (verification, recovery, uncertainty). The scenarios favour those features by construction; they test whether the features work and whether baselines without them fail, not how common such situations are in real applications.
2. **The expert baseline is my reconstruction**, not a measured expert's code; a different expert might add alternate locators or reconcile logic and close gaps.
3. **Scripted actors only.** There is no planning, grounding or hallucination in the loop.
4. **Single machine, concurrency 4.** Latency noise. The main runs use Chromium; Firefox and WebKit are covered only by the small cross-browser track (5 trials per scenario, two drivers).
5. **`pw-heal-naive` is a strawman policy** by design; it demonstrates a failure mode of masking recovery, and says nothing about any product.
6. **Spec leakage risk**: the spec contains alternate targets and `reconcile` hints supplied by the author; in an autonomous setting an actor must infer them (not measured).
7. Fixes made after smoke runs (ladder composition, no re-issue after a 2xx contradiction, redirect-hop policy) were driven by failures observed in earlier runs of the same scenarios, so Vedha has been tuned on these scenarios. Hold-out scenarios would be needed to claim generalisation.

## 8. Reproduce

```
pnpm install
npx playwright install chromium
pnpm bench -- --trials 20 --concurrency 4 --run-id my-run      # writes benchmarks/results/my-run/
npx tsx benchmarks/analysis/analyze.ts benchmarks/results/my-run
```

The environment, Playwright version and git state are captured in `env.json`.
