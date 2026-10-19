# Vedha

A testing framework for agent-driven and developer-authored browser tests. Core ideas, each motivated by evidence from reverse-engineering Playwright (see `research/`):

- **Verified semantic actions.** An action is `verified` only when framework-run, deterministic postconditions pass (URL, element state/value/text, network response and JSON fields, read-only API probes). No postcondition ⇒ `unverified`, never silently "passed".
- **Bounded recovery that keeps the evidence.** Alternate locators, known-interstitial dismissal and a single safe retry are tried in a fixed ladder; every attempt is a `RecoveryRecord` containing the _original_ failure. A run that needed recovery reports `passed_with_recovery`.
- **Uncertainty is a first-class result.** For `mutating` actions with an unobserved outcome the framework does not re-issue the action: it reconciles via a read-only probe, or reports `outcome_unknown`.
- **Bounded observations.** `controls` (interactive elements only), `outline` (ARIA tree, refs from Playwright), region/detail on demand, deltas between observations. Page-derived text is flagged `untrusted`.
- **Explore → promote → replay.** An actor (scripted, rule-based, or your LLM adapter) explores through the same verified runner; the result becomes a reviewable `TestProposal` and a plain `@playwright/test` spec, which can be replay-checked.
- **Failure bundles.** Goal, steps, verdicts, recovery records, network summary, redacted trace; `replay` re-drives the steps and reports divergences (and states what cannot be replayed).
- **No LLM required.** The core has no model dependency; LLM actors implement a small `Actor` interface outside the core.

It is **not** a Playwright wrapper that forwards commands: it uses Playwright as a replaceable browser substrate (`BrowserAdapter`) and owns the action/verification/recovery/promotion/bundle layers. It does not replace Playwright Test, and it reuses Playwright's actionability and auto-waiting (the strongest part of Playwright, per `research/playwright-execution-model.md`).

> **Status: v0.1 research MVP.** Superiority over other tools is _not_ claimed in general. See [Measured results](#measured-results) for exactly what was measured, with limits.

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

See `benchmarks/results/<run>/results.md` (generated from raw `trials.jsonl`) and the limits in `benchmarks/methodology.md`. The summary section below is filled from the final run.

Scripted (non-LLM) actors, 15 synthetic scenarios, 20 trials each, 1,500 trials per run; raw data in `benchmarks/results/`. Interpretation and limits: [`benchmarks/analysis/vedha-n20-interpretation.md`](benchmarks/analysis/vedha-n20-interpretation.md). Chromium, post-fix run (`vedha-n20-postfix`):

|                                                                                         | pw-trust | pw-test | pw-strong | pw-heal-naive | vedha |
| --------------------------------------------------------------------------------------- | -------- | ------- | --------- | ------------- | ----- |
| Seeded defects reported as pass (5 scenarios, 100 trials)                               | 40%      | 40%     | 0%        | 60%           | 0%    |
| Effect scenarios ending in a reported failure with no effect (10 scenarios, 200 trials) | 20%      | 30%     | 30%       | 20%           | 0%    |
| Mean duplicate side effects per trial                                                   | 0.00     | 0.07    | 0.13      | 0.00          | 0.00  |

On Firefox and WebKit (150 trials each, `vedha` vs `pw-strong` only) Vedha was correct in 75/75 on both; `pw-strong` 60/75 on both.

Reading it: on _these_ author-built scenarios, framework-run postconditions, recorded recovery and reconcile-before-retry avoided every false pass and duplicate; an expert Playwright configuration (`pw-strong`) matched on defect detection but not on UI changes or duplicate avoidance. **Hold-out caveat:** four scenarios (S12-S15) were run once on frozen code first; Vedha scored 0/20 on S12 there (it reported `uncertain` because an input step had no postcondition) and its label check was too loose. Both were fixed afterwards, so post-fix S12/S13 are no longer hold-out. This does **not** show Vedha is better in general: scenarios were chosen and the framework tuned by the same author, actors were scripted, and no LLM-driven tool (browser-use, Stagehand, Playwright MCP agents) was run end to end. Observation size (separate track): on a 400-row page an actor reads a median of 876 characters with `controls` observations versus 38k-114k for Playwright MCP snapshots (scripted; characters, not tokens; accuracy untested).

Reproduce: `pnpm bench -- --trials 20 --concurrency 4 --run-id my-run && npx tsx benchmarks/analysis/analyze.ts benchmarks/results/my-run`.

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
