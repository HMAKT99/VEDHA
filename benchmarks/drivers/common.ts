import { chromium, firefox, webkit } from "playwright";
import type { Browser, Locator, Page } from "playwright";
import type { ActionSpec, Target } from "@vedha/core";

/** Plain Playwright locator for a neutral Target. Baseline drivers use this; they do not import Vedha runtime code. */
export function locateTarget(page: Page | Locator, t: Target): Locator {
  if ("within" in t) return locateTarget(locateTarget(page, t.within), t.target);
  if ("role" in t)
    return page.getByRole(t.role as Parameters<Page["getByRole"]>[0], {
      name: t.name,
      exact: t.exact,
    });
  if ("testId" in t) return page.getByTestId(t.testId);
  if ("label" in t) return page.getByLabel(t.label, { exact: t.exact });
  if ("text" in t) return page.getByText(t.text, { exact: t.exact });
  return (page as Page).locator(`aria-ref=${t.ref}`);
}

export const DEFAULT_TIMEOUT = 5000;

/** Executes the bare action of a step with Playwright (no verification). */
export async function doAction(
  page: Page,
  s: ActionSpec,
  baseUrl: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const timeout = s.timeoutMs ?? DEFAULT_TIMEOUT;
  const loc = s.target ? locateTarget(page, s.target) : undefined;
  switch (s.op) {
    case "goto":
      await page.goto(new URL(s.value ?? "/", baseUrl).toString(), { timeout });
      break;
    case "click":
      await loc!.click({ timeout, force: opts.force });
      break;
    case "fill":
      await loc!.fill(s.value ?? "", { timeout, force: opts.force });
      break;
    case "select":
      await loc!.selectOption(s.value ?? "", { timeout });
      break;
    case "check":
      await loc!.check({ timeout, force: opts.force });
      break;
    case "press":
      if (loc) await loc.press(s.value ?? "", { timeout });
      else await page.keyboard.press(s.value ?? "");
      break;
  }
}

/** Browser engine for benchmark drivers: VEDHA_BROWSER=chromium|firefox|webkit (default chromium). */
export function launchBrowser(): Promise<Browser> {
  const name = (process.env.VEDHA_BROWSER ?? "chromium") as "chromium" | "firefox" | "webkit";
  return { chromium, firefox, webkit }[name].launch({ headless: true });
}
