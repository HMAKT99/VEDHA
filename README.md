# Vedha

A testing framework for agent-driven and developer-authored browser tests. Core ideas, each motivated by evidence from reverse-engineering Playwright (see `research/`):

- **Verified semantic actions.** An action is `verified` only when framework-run, deterministic postconditions pass (URL, element state/value/text, network response and JSON fields, read-only API probes). No postcondition ⇒ `unverified`, never silently "passed".
- **Bounded recovery that keeps the evidence.** Alternate locators, known-interstitial dismissal and a single safe retry are tried in a fixed ladder; every attempt is a `RecoveryRecord` containing the _original_ failure. A run that needed recovery reports `passed_with_recovery`.
- **Uncertainty is a first-class result.** For `mutating` actions with an unobserved outcome the framework does not re-issue the action: it reconciles via a read-only probe, or reports `outcome_unknown`.
- **Bounded observations.** `controls` (interactive elements only), `outline` (ARIA tree, refs from Playwright), region/detail on demand, deltas between observations. Page-derived text is flagged `untrusted`.
- **Explore → promote → replay.** An actor (scripted, rule-based, or your LLM adapter) explores through the same verified runner; the result becomes a reviewable `TestProposal` and a plain `@playwright/test` spec, which can be replay-checked.
- **Failure bundles.** Goal, steps, verdicts, recovery records, network summary, redacted trace; `replay` re-drives the steps and reports divergences (and states what cannot be replayed).
- **Agents can make mistakes without breaking the run.** Failures come back with a hint (`fill` on a dropdown: "use select"); the explore loop continues, but a repeat guard refuses to run the same mutating action again while its earlier outcome is unresolved, and an independent check (`confirms`) can clear an unknown outcome.
- **Server errors cannot hide behind an optimistic page.** A page-health check fails a mutating step if a request returned 5xx, a write was rejected, or the page threw, even when the declared checks passed.
- **Real-app reach.** Beyond click/fill/select/check/press: hover, double click, uncheck, upload (fail-closed `uploadRoots`), scroll, drag, wait, back, reload, tab switching, iframe targets, dialog policy.
- **Usable from any MCP client.** `@vedha/mcp` exposes the same engine as a stdio MCP server.
- **No LLM required.** The core has no model dependency; LLM actors implement a small `Actor` interface outside the core.

It is **not** a Playwright wrapper that forwards commands: it uses Playwright as a replaceable browser substrate (`BrowserAdapter`) and owns the action/verification/recovery/promotion/bundle layers. It does not replace Playwright Test, and it reuses Playwright's actionability and auto-waiting (the strongest part of Playwright, per `research/playwright-execution-model.md`).

> **Status: v0.1 research MVP.** Superiority over other tools is _not_ claimed in general; it ties expert baselines when everything is declared and leads in specific, measured cases. See [Measured results](#measured-results) for exactly what was measured, with limits.

## Quick start

```bash
nvm use 22 && pnpm install
npx playwright install chromium
pnpm build
node packages/cli/dist/bin.js doctor
```

### Deterministic spec (no LLM)

`order.json`:

```json
{
  "goal": "place an order",
  "steps": [
    {
      "id": "open",
      "intent": "open the form",
      "op": "goto",
      "value": "/",
      "postconditions": [{ "type": "state", "target": { "label": "Name" }, "state": "visible" }]
    },
    {
      "id": "name",
      "intent": "enter name",
      "op": "fill",
      "target": { "label": "Name" },
      "value": "Ada",
      "postconditions": [{ "type": "value", "target": { "label": "Name" }, "equals": "Ada" }]
    },
    {
      "id": "submit",
      "intent": "place the order",
      "op": "click",
      "target": { "role": "button", "name": "Place order" },
      "altTargets": [{ "testId": "place-order" }],
      "dismiss": [{ "role": "button", "name": "Accept" }],
      "mutating": true,
      "postconditions": [
        { "type": "text", "target": { "role": "status" }, "contains": "Order placed" },
        {
          "type": "network",
          "method": "POST",
          "urlPattern": "/api/orders",
          "status": "2xx",
          "json": { "path": "qty", "equals": 3 }
        }
      ],
      "reconcile": { "type": "api", "get": "/api/orders", "matchesAny": { "name": "Ada" } }
    }
  ]
}
```

```bash
node packages/cli/dist/bin.js run order.json --base-url http://localhost:3000 --out ./failure-bundle
# exit 0 passed | 1 failed | 2 blocked | 4 outcome_unknown | 5 unverified ; JSON report on stdout
node packages/cli/dist/bin.js replay ./failure-bundle --base-url http://localhost:3000
```

### SDK

```ts
import { openSession } from "@vedha/adapter-playwright";

const session = await openSession({ allowedDomains: ["localhost"] });
const report = await session.run(steps); // ActionSpec[]
console.log(
  report.verdict,
  report.steps.map((s) => [s.actionId, s.status, s.recovered]),
);
await session.close();
```

Wrap an existing Playwright page: `sessionFromPage(page, policy)`.

### Agent-driven exploration → regression test

```bash
node packages/cli/dist/bin.js explore goal.json --start-url http://localhost:3000/ \
  --promote order.spec.ts --check http://localhost:3000   # generates the spec and replay-checks it
```

The shipped `RuleActor` is a heuristic form-filler used for tests and benchmarks. To use an LLM, implement `Actor.decide({goal, observation, history, step})` and return an `ActionSpec` or `done`; the framework enforces policy, verification and budgets regardless of what the actor proposes. No provider is bundled and nothing is sent anywhere by default.

### Use it from an MCP client

```bash
pnpm build
node packages/mcp/dist/bin.js --allow-domain localhost --out ./vedha-out
```

Tools: `vedha_act` (one action with the checks you declare in `expect`), `vedha_observe`, `vedha_report`, `vedha_promote` (verified steps to a Playwright spec), `vedha_bundle`, `vedha_close`. The server refuses to start without `--allow-domain HOST` or an explicit `--allow-any-domain`. Mark data-changing steps `mutating: true`; after an unknown outcome Vedha refuses to repeat them until a check confirms the effect (`confirms: "<step id>"`).

### Migrating a Playwright test

```ts
// before
await page.getByRole("button", { name: "Save" }).click();
await expect(page.getByRole("status")).toHaveText("Saved");
```

```ts
// after (wraps your existing page; the rest of the test is unchanged)
const af = await sessionFromPage(page);
const r = await af.step({
  id: "save",
  intent: "save the form",
  op: "click",
  target: { role: "button", name: "Save" },
  altTargets: [{ testId: "save" }],
  postconditions: [{ type: "text", target: { role: "status" }, equals: "Saved" }],
});
expect(r.status).toBe("verified"); // r.recoveries explains any recovery that was needed
```

More in `design/migration-and-compatibility.md`.

## Measured results

Everything below is from raw `trials.jsonl` files under `benchmarks/results/`; protocols, limits and amendments are in `benchmarks/preregistration.md` and `benchmarks/methodology.md`. Scripted tracks use no model. "Expert" baselines (`pw-strong`, `sel-strong`) were given every technique the scenarios' declared checks allow, including state probes.

| Track                                                                            | What was run                                                        | Result                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Held-out widget families, full declarations                                      | 17 scenarios x 7 drivers x 20 trials (`heldout-n20-final`)          | Vedha, expert Playwright and expert Selenium tie: 200/200 healthy, 138-140/140 defects, 0 false passes. Weaker baselines detect 0/140.                                                                                                                                     |
| Held-out widget families, minimal declarations (text/url only)                   | same, 20 trials (`heldout-min-n20-final`)                           | **Vedha detects 60/140** (every rejected-write defect); every Playwright and Selenium baseline 0/140; healthy 200/200 for Vedha and the expert baselines; false-pass 19-28% vs 36-58%. All frameworks miss silent drops (HTTP 200, nothing recorded) on these fixtures.    |
| Cross-implementation: 16 third-party TodoMVC implementations                     | 4 user-level scenarios, 3 trials (`multi-n3-final`)                 | Vedha 189/192 (96-99%); expert Playwright 182, expert Selenium 183, `pw-test` 183 (all 91-98%): best point estimate, **intervals overlap**. Vedha 0 false passes and 0 false fails; expert Playwright 6 false fails (its default `toHaveText` also reads CSS-hidden text). |
| Independent app with mutants (TodoMVC)                                           | 10 scenarios, n=5, Vedha vs expert Playwright                       | both 50/50 after idle-aware classification (before it Vedha reported "uncertain" on client-only defects). n=20 and the other drivers still to run.                                                                                                                         |
| Conventional-REST silent drop (S16, added after the feature: a positive control) | 10 trials                                                           | Vedha 10/10 detected via read-back inference; `pw-trust`, `pw-test`, `pw-strong` 0/10 with the same typical declarations. On the pre-registered widget silent drops (non-conventional endpoints) read-back caught **0/20**; that planned target was not met.               |
| Generated regression test (B8)                                                   | explore -> promote, run on 3 healthy and 4 broken variants          | promoted test: 9/9 healthy, 12/12 defects caught; recorder-style references 9/9 and 3/12 (constructed references, one app).                                                                                                                                                |
| Security red-team over MCP (B7)                                                  | 5 hostile cases, 3 trials, each MCP server configured as documented | Playwright MCP's origin allowlist let a GET redirect, a POST redirect and a WebSocket through 3/3 each; Vedha 0/15; both blocked subresources and redacted a secret. Consistent with Playwright MCP's own docs that origin filtering is not a security boundary.           |
| Overhead (B5)                                                                    | 8 healthy scenarios, 10 trials, concurrency 1                       | Vedha 1.06-1.44x expert Playwright per scenario (+10-110 ms); the planned <=15% target is **not met** in relative terms; faster on the slow-UI scenario.                                                                                                                   |
| LLM, MCP vs MCP (pilot 3b, one free model, n=2 per cell)                         | Playwright MCP vs Vedha MCP on 8 shop scenarios                     | completion tie (11/12 each), Vedha about 18% fewer tokens; neither model concluded on the defect scenarios within the turn cap. The held-out widget LLM track (pilot 4) is running.                                                                                        |

What this does **not** show: that Vedha beats expert Playwright or expert Selenium when the author declares everything (it ties); anything about models beyond one free model family; anything about real production apps; Chromium-only for Selenium. Several results are mechanism-specific by design (read-back needs a conventional REST convention; the page-health check needs a request that returned an error).

Reproduce a scripted track: `pnpm bench -- --set held-out --trials 20 --concurrency 3 --run-id my-run` (sets: `seen`, `held-out`, `held-out-minimal`, `independent`, `multi`; the last two need `VEDHA_TODOMVC_DIR` pointing at a clone of tastejs/todomvc; Selenium drivers are opt-in via `--drivers sel-trust,sel-strong`). Merge valid parts of several runs with `benchmarks/analysis/merge.ts`.

## Repository map

| Path                          | What                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `research/`                   | Reverse-engineering of Playwright with REA, ecosystem study, evidence ledger, open questions  |
| `design/`                     | Gap matrix-driven architecture proposals, selected architecture, ADRs                         |
| `packages/core`               | Types/schemas, runner, verifiers, observation, policy, bundle, promotion, explorer            |
| `packages/adapter-playwright` | Playwright `BrowserAdapter` (+ policy via routing incl. redirect hops, generated-spec runner) |
| `packages/cli`                | `vedha` CLI                                                                                   |
| `benchmarks/`                 | Fixture app, scenarios, drivers, harness, analysis, methodology, raw results                  |
| `IMPLEMENTATION_STATUS.md`    | Phase status, tests run, blockers, unverified assumptions                                     |

## Security

Page and repository content is treated as untrusted data; see [SECURITY.md](SECURITY.md) for the threat model and known limits (notably: Playwright route handlers do not see redirect hops - Vedha validates them itself; WebSockets are gated and service workers blocked in launched sessions; Chromium only was tested).

## Contributing / License

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under Apache-2.0 (see `LICENSE`).
