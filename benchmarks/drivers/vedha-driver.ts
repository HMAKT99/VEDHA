import type { Browser } from "playwright";
import { launchBrowser } from "./common.js";
import { PlaywrightAdapter } from "@vedha/adapter-playwright";
import { Session } from "@vedha/core";
import type { ActionSpec } from "@vedha/core";
import type { Scenario } from "../scenarios/index.js";
import type { Driver, DriverOutcome } from "./types.js";

/** Vedha deterministic mode: runs the neutral spec through Session (verified actions + bounded recovery). */
export class VedhaDriver implements Driver {
  id = "vedha";
  description =
    "Vedha Session: postconditions verified by the framework, recorded bounded recovery, reconcile for mutating actions.";
  private browser!: Browser;
  async setup() {
    this.browser = await launchBrowser();
  }
  async teardown() {
    await this.browser.close();
  }
  async run(sc: Scenario, baseUrl: string): Promise<DriverOutcome> {
    const ctx = await this.browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await ctx.newPage();
    const session = await Session.create(PlaywrightAdapter.fromPage(page), {
      allowedDomains: [new URL(baseUrl).hostname],
      ...sc.policy,
    });
    try {
      const specs: ActionSpec[] = sc.steps.map((s) =>
        s.op === "goto" ? { ...s, value: new URL(s.value ?? "/", baseUrl).toString() } : s,
      );
      const report = await session.run(specs);
      const recoveries = report.steps.reduce((n, r) => n + r.recoveries.length, 0);
      const claim =
        report.verdict === "passed" || report.verdict === "passed_with_recovery"
          ? "pass"
          : report.verdict === "outcome_unknown" || report.verdict === "unverified"
            ? "uncertain"
            : "fail";
      const bad = report.steps.find((r) => r.status !== "verified" && r.status !== "unverified");
      return {
        claim,
        browserActions: report.browserActions,
        observationChars: report.observationChars,
        recoveries,
        diagnostic: bad
          ? `${bad.actionId}: ${bad.status} ${bad.error?.code ?? ""} ${bad.error?.message ?? ""}`.slice(
              0,
              300,
            )
          : "",
        notes: report.verdict === "passed_with_recovery" ? "passed_with_recovery" : undefined,
      };
    } finally {
      await ctx.close();
    }
  }
}
