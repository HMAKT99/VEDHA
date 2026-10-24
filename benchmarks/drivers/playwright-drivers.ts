import type { Browser, Page } from "playwright";
import { expect } from "@playwright/test";
import type { ActionSpec, Verifier } from "@vedhajs/core";
import type { Scenario } from "../scenarios/index.js";
import type { Driver, DriverOutcome } from "./types.js";
import { DEFAULT_TIMEOUT, acceptDialogs, doAction, launchBrowser, locateTarget } from "./common.js";

abstract class PlaywrightBase implements Driver {
  abstract id: string;
  abstract description: string;
  protected browser!: Browser;
  async setup() {
    this.browser = await launchBrowser();
  }
  async teardown() {
    await this.browser.close();
  }
  abstract run(scenario: Scenario, baseUrl: string): Promise<DriverOutcome>;
}

/**
 * pw-trust: a Playwright script / agent-tool style harness where "the action returned" means success.
 * No assertions, no retries.
 */
export class PwTrust extends PlaywrightBase {
  id = "pw-trust";
  description =
    "Playwright actions only; success = no exception (semantics of an agent tool that reports the action result).";
  async run(sc: Scenario, baseUrl: string): Promise<DriverOutcome> {
    const ctx = await this.browser.newContext({ viewport: { width: 1000, height: 800 } });
    let page = await ctx.newPage();
    let actions = 0;
    try {
      for (const s of sc.steps) {
        actions++;
        page = await doAction(page, s, baseUrl);
      }
      return {
        claim: "pass",
        browserActions: actions,
        observationChars: 0,
        recoveries: 0,
        diagnostic: "",
      };
    } catch (e) {
      return {
        claim: "fail",
        browserActions: actions,
        observationChars: 0,
        recoveries: 0,
        diagnostic: firstLine(e),
      };
    } finally {
      await ctx.close();
    }
  }
}

function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e))
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .slice(0, 3)
    .join(" | ")
    .slice(0, 300);
}

type UiVerifier = Extract<Verifier, { type: "text" | "value" | "state" | "url" }>;
const isUi = (v: Verifier): v is UiVerifier => ["text", "value", "state", "url"].includes(v.type);

async function assertUi(page: Page, v: UiVerifier, timeout: number): Promise<void> {
  switch (v.type) {
    case "text": {
      const loc = v.target ? locateTarget(page, v.target) : page.locator("body");
      if (v.equals !== undefined) await expect(loc).toHaveText(v.equals, { timeout });
      else await expect(loc).toContainText(v.contains ?? "", { timeout });
      return;
    }
    case "value":
      await expect(locateTarget(page, v.target)).toHaveValue(v.equals, { timeout });
      return;
    case "state": {
      const loc = locateTarget(page, v.target);
      if (v.state === "visible") await expect(loc).toBeVisible({ timeout });
      else if (v.state === "hidden") await expect(loc).toBeHidden({ timeout });
      else if (v.state === "enabled") await expect(loc).toBeEnabled({ timeout });
      else if (v.state === "disabled") await expect(loc).toBeDisabled({ timeout });
      else await expect(loc).toBeChecked({ timeout });
      return;
    }
    case "url": {
      const re =
        v.matches.length >= 3 && v.matches.startsWith("/") && v.matches.endsWith("/")
          ? new RegExp(v.matches.slice(1, -1))
          : new RegExp(v.matches.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      await expect(page).toHaveURL(re, { timeout });
    }
  }
}

/** Read-only state probe, as an expert author writes with expect.poll and the request fixture. */
async function assertApi(
  page: Page,
  v: Extract<Verifier, { type: "api" }>,
  baseUrl: string,
  timeout: number,
): Promise<void> {
  const url = new URL(v.get, baseUrl).toString();
  await expect
    .poll(
      async () => {
        const r = await page.request.get(url);
        if (!r.ok()) return false;
        const body = (await r.json()) as unknown;
        const items = Array.isArray(body) ? body : [body];
        return items.some((it) =>
          Object.entries(v.matchesAny).every(
            ([k, val]) => (it as Record<string, unknown> | null)?.[k] === val,
          ),
        );
      },
      { timeout },
    )
    .toBe(true);
}

/**
 * pw-test: a conventional Playwright Test with web-first UI assertions and `retries: 1`
 * (the whole test is re-run in a fresh context on failure; server state persists).
 */
export class PwTest extends PlaywrightBase {
  id = "pw-test";
  description =
    "Playwright Test style: UI-level web-first assertions (text/value/state/url), retries: 1 (whole test re-run).";
  protected useNetwork = false;
  protected useLocatorHandler = false;
  async run(sc: Scenario, baseUrl: string): Promise<DriverOutcome> {
    let actions = 0;
    let lastDiag = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctx = await this.browser.newContext({ viewport: { width: 1000, height: 800 } });
      const page = await ctx.newPage();
      let cur = page;
      if (sc.policy?.dialogs === "accept") acceptDialogs(page);
      try {
        if (this.useLocatorHandler) {
          const dismiss = sc.steps.flatMap((s) => s.dismiss ?? []);
          for (const d of dismiss) {
            await page.addLocatorHandler(locateTarget(page, d), async (l) => {
              await l.click();
            });
          }
        }
        for (const s of sc.steps) {
          const timeout = s.timeoutMs ?? DEFAULT_TIMEOUT;
          const nets = this.useNetwork
            ? (s.postconditions ?? []).filter(
                (v): v is Extract<Verifier, { type: "network" }> => v.type === "network",
              )
            : [];
          const waits = nets.map((n) =>
            cur.waitForResponse(
              (r) =>
                r.url().includes(n.urlPattern) &&
                (!n.method || r.request().method() === n.method.toUpperCase()),
              { timeout },
            ),
          );
          waits.forEach((w) => w.catch(() => undefined));
          actions++;
          cur = await doAction(cur, s, baseUrl);
          for (let i = 0; i < nets.length; i++) {
            const n = nets[i]!;
            const r = await waits[i]!;
            const okStatus =
              n.status === "2xx" || n.status === undefined ? r.ok() : r.status() === n.status;
            if (!okStatus) throw new Error(`response ${r.status()} for ${n.urlPattern}`);
            if (n.json) {
              const body = (await r.json()) as Record<string, unknown>;
              const got = n.json.path
                .split(".")
                .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], body);
              if (got !== n.json.equals)
                throw new Error(
                  `json ${n.json.path}=${JSON.stringify(got)} expected ${JSON.stringify(n.json.equals)}`,
                );
            }
          }
          for (const v of s.postconditions ?? []) {
            if (isUi(v)) await assertUi(cur, v, timeout);
            else if (v.type === "api" && this.useNetwork) await assertApi(cur, v, baseUrl, timeout);
          }
        }
        return {
          claim: "pass",
          browserActions: actions,
          observationChars: 0,
          recoveries: 0,
          diagnostic: "",
          notes: attempt ? "passed on retry" : undefined,
        };
      } catch (e) {
        lastDiag = firstLine(e);
      } finally {
        await ctx.close();
      }
    }
    return {
      claim: "fail",
      browserActions: actions,
      observationChars: 0,
      recoveries: 0,
      diagnostic: lastDiag,
    };
  }
}

/**
 * pw-strong: what an expert Playwright author would write for the same task: UI assertions,
 * response assertions via waitForResponse, addLocatorHandler for the known banner, retries: 1.
 * It does not use alternate locators or read-back reconciliation.
 */
export class PwStrong extends PwTest {
  override id = "pw-strong";
  override description =
    "Expert Playwright Test: UI + response assertions, addLocatorHandler for known interstitials, retries: 1.";
  protected override useNetwork = true;
  protected override useLocatorHandler = true;
}

/**
 * pw-heal-naive: reference *policy* (not a named product): trust-return semantics plus a generic
 * "heal" that re-issues a timed-out action with force:true. Included to measure how a masking
 * recovery policy behaves, not to represent any specific tool.
 */
export class PwHealNaive extends PlaywrightBase {
  id = "pw-heal-naive";
  description = "Reference policy: trust-return + on action failure retry once with force:true.";
  async run(sc: Scenario, baseUrl: string): Promise<DriverOutcome> {
    const ctx = await this.browser.newContext({ viewport: { width: 1000, height: 800 } });
    let page = await ctx.newPage();
    let actions = 0;
    let recoveries = 0;
    try {
      for (const s of sc.steps) {
        actions++;
        try {
          page = await doAction(page, s, baseUrl);
        } catch (e) {
          if (s.op === "goto") throw e;
          recoveries++;
          actions++;
          page = await doAction(page, { ...s, timeoutMs: 1500 }, baseUrl, { force: true });
        }
      }
      return {
        claim: "pass",
        browserActions: actions,
        observationChars: 0,
        recoveries,
        diagnostic: "",
      };
    } catch (e) {
      return {
        claim: "fail",
        browserActions: actions,
        observationChars: 0,
        recoveries,
        diagnostic: firstLine(e),
      };
    } finally {
      await ctx.close();
    }
  }
}

export type { ActionSpec };
