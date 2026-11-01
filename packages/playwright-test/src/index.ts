import { test as base, expect } from "@playwright/test";
import { sessionFromPage } from "@vedhajs/adapter-playwright";
import { createBundle, describeResult } from "@vedhajs/core";
import type { ActionResult, ActionSpec, Policy, RunReport, Session } from "@vedhajs/core";
import {
  failedRequestFinding,
  guardError,
  pageErrorFinding,
  resolveGuard,
  responseFinding,
  watched,
} from "./guard.js";
import type { GuardFinding, GuardSetting } from "./guard.js";

export { expect };
export type { ActionResult, ActionSpec, Policy, RunReport };
export type { GuardFinding, GuardOptions, GuardSetting } from "./guard.js";

/** What the `vedha` fixture gives a test. */
export interface VedhaHandle {
  /** The underlying session (observe, results, trace). */
  readonly session: Session;
  /** Runs one step and returns its result without asserting anything. */
  step(spec: ActionSpec): Promise<ActionResult>;
  /**
   * Runs one step and throws a readable error unless it verified. Use for steps that must hold.
   * The message includes the failed checks, the hint and any recovery that was needed.
   */
  verify(spec: ActionSpec): Promise<ActionResult>;
  report(): RunReport;
}

export interface VedhaOptions {
  /** Policy for the session (allowed domains, dialogs, uploadRoots, health ...). */
  vedhaPolicy: Policy;
  /**
   * When true (default) the test fails at teardown if any step was not verified (failed, blocked,
   * outcome_unknown or unverified). Set false for tests that expect failures.
   */
  vedhaStrict: boolean;
  /**
   * Guard mode for ordinary Playwright tests, on by default: fails a test whose own checks passed if
   * the app answered a request with 5xx or a write request failed, and annotates 4xx answers to writes
   * and uncaught page errors. "strict" makes those fail too; `false` turns it off.
   */
  vedhaGuard: GuardSetting;
}

/** The frame's page URL, or undefined for requests without one (service workers). */
function pageUrlOf(frame: () => { page(): { url(): string } | null }): string | undefined {
  try {
    return frame().page()?.url();
  } catch {
    return undefined;
  }
}

const OK = new Set(["passed", "passed_with_recovery"]);

function explain(spec: ActionSpec, r: ActionResult): string {
  return [`step "${spec.id}" (${spec.intent}) did not verify`, ...describeResult(r)].join("\n  ");
}

/**
 * Drop-in replacement for Playwright's `test`. Changing the import alone turns on guard mode
 * (`vedhaGuard`) for existing tests. For checked steps, use the `vedha` fixture:
 *
 *   import { test, expect } from "@vedhajs/playwright-test";
 *   test("order", async ({ vedha }) => {
 *     await vedha.verify({ id: "save", intent: "save", op: "click", target: {...}, postconditions: [...] });
 *   });
 *
 * Runner features (retries, sharding, reporters, traces) work unchanged. The run report and, when
 * anything did not verify, the failure bundle are attached to the test result.
 */
export const test = base.extend<{ vedha: VedhaHandle; _vedhaGuard: void } & VedhaOptions>({
  vedhaPolicy: [{}, { option: true }],
  vedhaStrict: [true, { option: true }],
  vedhaGuard: [true, { option: true }],
  _vedhaGuard: [
    async ({ context, vedhaGuard, vedhaStrict }, use, testInfo) => {
      const o = resolveGuard(vedhaGuard);
      if (!o) return use();
      const found: GuardFinding[] = [];
      // vedhaStrict: false means the test expects failures, so guard findings only annotate it.
      const add = (f: GuardFinding | undefined) =>
        f && found.push(vedhaStrict ? f : { ...f, level: "warn" });
      context.on("response", (r) => {
        const req = r.request();
        if (
          watched(
            r.url(),
            pageUrlOf(() => r.frame()),
            o,
          )
        )
          add(responseFinding(req.method(), r.url(), r.status(), o));
      });
      context.on("requestfailed", (req) => {
        if (
          watched(
            req.url(),
            pageUrlOf(() => req.frame()),
            o,
          )
        )
          add(failedRequestFinding(req.method(), req.url(), req.failure()?.errorText ?? "failed"));
      });
      context.on("weberror", (e) => add(pageErrorFinding(e.error().message, o)));

      await use();

      if (!found.length) return;
      await testInfo.attach("vedha-guard.json", {
        body: JSON.stringify(found, null, 2),
        contentType: "application/json",
      });
      for (const f of found.filter((x) => x.level === "warn"))
        testInfo.annotations.push({ type: "vedha-guard warning", description: f.message });
      const fails = found.filter((x) => x.level === "fail");
      // A test that already failed keeps its own error; the findings are in the attachment.
      if (fails.length && testInfo.errors.length === 0) throw guardError(fails);
    },
    { auto: true },
  ],
  vedha: async ({ page, vedhaPolicy, vedhaStrict }, use, testInfo) => {
    const session = await sessionFromPage(page, vedhaPolicy);
    const handle: VedhaHandle = {
      session,
      step: (spec) => session.step(spec),
      verify: async (spec) => {
        const r = await session.step(spec);
        if (r.status !== "verified") throw new Error(explain(spec, r));
        return r;
      },
      report: () => session.report(),
    };
    await use(handle);

    const report = session.report();
    if (!report.steps.length) return;
    await testInfo.attach("vedha-report.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    if (!OK.has(report.verdict)) {
      const bundle = createBundle(session, testInfo.title);
      await testInfo.attach("vedha-failure-bundle.json", {
        body: JSON.stringify(bundle, null, 2),
        contentType: "application/json",
      });
      if (vedhaStrict) {
        const bad = report.steps.filter(
          (s) => s.status !== "verified" && s.status !== "unverified",
        );
        throw new Error(
          `Vedha run verdict: ${report.verdict}` +
            (bad.length ? ` (${bad.map((s) => `${s.actionId}: ${s.status}`).join(", ")})` : ""),
        );
      }
    }
  },
});
