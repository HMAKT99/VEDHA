import { chromium, firefox, webkit } from "playwright";
import type { Browser, FrameLocator, Locator, Page } from "playwright";
import type { ActionSpec, Target } from "@vedha/core";

/** Plain Playwright locator for a neutral Target. Baseline drivers use this; they do not import Vedha runtime code. */
export function locateTarget(page: Page | Locator | FrameLocator, t: Target): Locator {
  if ("within" in t) return locateTarget(locateTarget(page, t.within), t.target);
  if ("inFrame" in t) return locateTarget(page.frameLocator(t.inFrame), t.target);
  if ("role" in t)
    return page.getByRole(t.role as Parameters<Page["getByRole"]>[0], {
      name: t.name,
      exact: t.exact,
    });
  if ("testId" in t) return page.getByTestId(t.testId);
  if ("css" in t) return page.locator(t.css);
  if ("label" in t) return page.getByLabel(t.label, { exact: t.exact });
  if ("text" in t) return page.getByText(t.text, { exact: t.exact });
  return (page as Page).locator(`aria-ref=${t.ref}`);
}

export const DEFAULT_TIMEOUT = 5000;

/**
 * Executes the bare action of a step with Playwright (no verification). Returns the page that is
 * current afterwards (it changes only for switch_tab).
 */
export async function doAction(
  page: Page,
  s: ActionSpec,
  baseUrl: string,
  opts: { force?: boolean } = {},
): Promise<Page> {
  const timeout = s.timeoutMs ?? DEFAULT_TIMEOUT;
  const loc = s.target ? locateTarget(page, s.target) : undefined;
  switch (s.op) {
    case "goto":
      await page.goto(new URL(s.value ?? "/", baseUrl).toString(), { timeout });
      break;
    case "click":
      await loc!.click({ timeout, force: opts.force });
      break;
    case "dblclick":
      await loc!.dblclick({ timeout, force: opts.force });
      break;
    case "hover":
      await loc!.hover({ timeout });
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
    case "uncheck":
      await loc!.uncheck({ timeout, force: opts.force });
      break;
    case "press":
      if (loc) await loc.press(s.value ?? "", { timeout });
      else await page.keyboard.press(s.value ?? "");
      break;
    case "upload":
      await loc!.setInputFiles(
        (s.value ?? "").split(",").map((f) => f.trim()),
        { timeout },
      );
      break;
    case "scroll":
      if (loc) await loc.scrollIntoViewIfNeeded({ timeout });
      else
        await page.evaluate((d) => {
          if (d === "top") window.scrollTo(0, 0);
          else if (d === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
          else window.scrollBy(0, (d === "up" ? -1 : 1) * window.innerHeight * 0.8);
        }, s.value ?? "down");
      break;
    case "drag":
      await loc!.dragTo(locateTarget(page, s.to!), { timeout });
      break;
    case "wait":
      await page.waitForTimeout(Math.min(Number(s.value) || 0, 5000));
      break;
    case "back":
      await page.goBack({ timeout });
      break;
    case "reload":
      await page.reload({ timeout });
      break;
    case "switch_tab": {
      const pages = page.context().pages();
      const idx =
        s.value === "first"
          ? 0
          : s.value === undefined || s.value === "last"
            ? pages.length - 1
            : Number(s.value);
      const next = pages[idx];
      if (!next) throw new Error(`no tab at index ${String(s.value)}`);
      await next.bringToFront();
      return next;
    }
  }
  return page;
}

/** Accepts JavaScript dialogs on every page of the context (what a test author does for a confirm()). */
export function acceptDialogs(page: Page): void {
  const handle = (p: Page) => p.on("dialog", (d) => void d.accept().catch(() => undefined));
  handle(page);
  page.context().on("page", handle);
}

/** Browser engine for benchmark drivers: VEDHA_BROWSER=chromium|firefox|webkit (default chromium). */
export function launchBrowser(): Promise<Browser> {
  const name = (process.env.VEDHA_BROWSER ?? "chromium") as "chromium" | "firefox" | "webkit";
  return { chromium, firefox, webkit }[name].launch({ headless: true });
}
