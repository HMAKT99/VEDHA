import { createRequire } from "node:module";
import type { WebDriver, WebElement } from "selenium-webdriver";
import type { Target, Verifier } from "@vedhajs/core";
import type { Scenario } from "../scenarios/index.js";
import type { Driver, DriverOutcome } from "./types.js";

const require = createRequire(import.meta.url);
const selenium = require("selenium-webdriver") as typeof import("selenium-webdriver");
const chrome =
  require("selenium-webdriver/chrome") as typeof import("selenium-webdriver/chrome.js");
const { Builder, By, until } = selenium;

const DEFAULT_TIMEOUT = 5000;

const xq = (s: string) =>
  s.includes("'") ? `concat('${s.split("'").join(`', "'", '`)}')` : `'${s}'`;

/** XPath alternatives for a neutral Target. `scoped` makes them relative to a parent element. */
function xpaths(t: Target, scoped: boolean): string[] {
  const p = scoped ? ".//" : "//";
  if ("role" in t) {
    const n = t.name;
    const has = (attr: string) => (n === undefined ? "" : `[${attr}]`);
    switch (t.role) {
      case "button":
        return n === undefined
          ? [`${p}button`, `${p}*[@role='button']`]
          : [
              `${p}button[normalize-space(.)=${xq(n)} or normalize-space(@aria-label)=${xq(n)}]`,
              `${p}*[@role='button'][normalize-space(.)=${xq(n)}]`,
              `${p}input[(@type='button' or @type='submit') and @value=${xq(n)}]`,
            ];
      case "link":
        return [`${p}a${n === undefined ? "" : `[normalize-space(.)=${xq(n)}]`}`];
      case "heading":
        return ["h1", "h2", "h3", "h4", "h5", "h6"].map(
          (h) => `${p}${h}${n === undefined ? "" : `[normalize-space(.)=${xq(n)}]`}`,
        );
      case "status":
        return [`${p}*[@role='status']`];
      case "textbox":
      case "searchbox":
        return n === undefined
          ? [`${p}input[not(@type) or @type='text' or @type='search']`, `${p}textarea`]
          : [
              `${p}input[@placeholder=${xq(n)} or @aria-label=${xq(n)}]`,
              `${p}textarea[@placeholder=${xq(n)} or @aria-label=${xq(n)}]`,
            ];
      case "row":
        return [`${p}tr${n === undefined ? "" : `[contains(normalize-space(.), ${xq(n)})]`}`];
      default:
        return [`${p}*[@role=${xq(t.role)}]${has(`normalize-space(.)=${xq(n ?? "")}`)}`];
    }
  }
  if ("label" in t)
    return [
      `${p}label[normalize-space(.)=${xq(t.label)}]//input`,
      `${p}label[normalize-space(.)=${xq(t.label)}]//select`,
      `${p}label[normalize-space(.)=${xq(t.label)}]//textarea`,
      `${p}input[@id=//label[normalize-space(.)=${xq(t.label)}]/@for]`,
    ];
  if ("testId" in t) return [`${p}*[@data-testid=${xq(t.testId)}]`];
  if ("text" in t) return [`${p}*[normalize-space(text())=${xq(t.text)}]`];
  throw new Error("unsupported target for the Selenium baseline");
}

async function find(
  driver: WebDriver,
  t: Target,
  timeoutMs: number,
  scope?: WebElement,
): Promise<WebElement> {
  if ("within" in t) {
    const parent = await find(driver, t.within, timeoutMs, scope);
    return find(driver, t.target, timeoutMs, parent);
  }
  if ("inFrame" in t) throw new Error("frame targets are resolved by inFrameContext");
  const by = "css" in t ? By.css(t.css) : By.xpath(xpaths(t, !!scope).join(" | "));
  const root = scope ?? driver;
  // driver.wait with a 0 timeout waits forever, so a zero budget is a single (implicit-wait) lookup.
  if (timeoutMs <= 0) {
    const els = await root.findElements(by);
    if (!els[0]) throw new Error(`no such element: ${JSON.stringify(t)}`);
    return els[0];
  }
  return (await driver.wait(
    async () => (await root.findElements(by))[0],
    timeoutMs,
    `no such element: ${JSON.stringify(t)}`,
  )) as WebElement;
}

/** Switches into the iframe a target names (if any), runs `fn` on the inner target, and switches back. */
async function inFrameContext<T>(
  driver: WebDriver,
  t: Target | undefined,
  timeoutMs: number,
  fn: (inner: Target | undefined) => Promise<T>,
): Promise<T> {
  if (!t || !("inFrame" in t)) return fn(t);
  await driver.switchTo().defaultContent();
  const frame =
    timeoutMs > 0
      ? await driver.wait(until.elementLocated(By.css(t.inFrame)), timeoutMs)
      : await driver.findElement(By.css(t.inFrame));
  await driver.switchTo().frame(frame);
  try {
    return await fn(t.target);
  } finally {
    await driver.switchTo().defaultContent();
  }
}

const INSTALL_FETCH_LOG = `
if (!window.__vlog) {
  window.__vlog = [];
  const of = window.fetch;
  window.fetch = async function (...a) {
    const r = await of.apply(this, a);
    try {
      const c = r.clone();
      let j; try { j = await c.json(); } catch (e) {}
      window.__vlog.push({ method: ((a[1] && a[1].method) || 'GET').toUpperCase(), url: String((a[0] && a[0].url) || a[0]), status: r.status, json: j });
    } catch (e) {}
    return r;
  };
}`;

abstract class SeleniumBase implements Driver {
  abstract id: string;
  abstract description: string;
  protected driver!: WebDriver;
  /** W3C unhandled-prompt behaviour; strong setups accept dialogs, plain ones keep the default. */
  protected promptBehavior?: "accept";
  async setup() {
    const opts = new chrome.Options();
    opts.addArguments("--headless=new", "--window-size=1000,800");
    const builder = new Builder().forBrowser("chrome").setChromeOptions(opts);
    if (this.promptBehavior)
      builder.withCapabilities({ unhandledPromptBehavior: this.promptBehavior });
    this.driver = await builder.build();
  }
  async teardown() {
    await this.driver.quit();
  }
  abstract run(sc: Scenario, baseUrl: string): Promise<DriverOutcome>;

  /** Chrome can die under load; a real suite recreates the session, so the harness does too. */
  protected async ensureAlive(): Promise<void> {
    try {
      await this.driver.getAllWindowHandles();
    } catch {
      await this.driver.quit().catch(() => undefined);
      await this.setup();
      this.recreated++;
    }
  }
  /** Times the session had to be recreated (reported in the run notes). */
  recreated = 0;

  /** Clean slate between trials: close extra tabs, drop any open dialog, leave frames, blank page. */
  protected async reset(): Promise<void> {
    await this.ensureAlive();
    const d = this.driver;
    await d
      .switchTo()
      .alert()
      .dismiss()
      .catch(() => undefined);
    const handles = await d.getAllWindowHandles();
    for (const h of handles.slice(1)) {
      await d.switchTo().window(h);
      await d.close();
    }
    if (handles[0]) await d.switchTo().window(handles[0]);
    await d.switchTo().defaultContent();
    await d.get("about:blank");
    await d.manage().deleteAllCookies();
  }
}

type Spec = Scenario["steps"][number];

const JS_DRAG = `
const [src, dst] = arguments;
const dt = new DataTransfer();
const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
fire(src, "dragstart"); fire(dst, "dragenter"); fire(dst, "dragover"); fire(dst, "drop"); fire(src, "dragend");`;

async function act(
  driver: WebDriver,
  s: Spec,
  baseUrl: string,
  waitMs: number,
  strong: boolean,
): Promise<void> {
  switch (s.op) {
    case "goto":
      await driver.get(new URL(s.value ?? "/", baseUrl).toString());
      return;
    case "back":
      await driver.navigate().back();
      return;
    case "reload":
      await driver.navigate().refresh();
      return;
    case "wait":
      await new Promise((r) => setTimeout(r, Math.min(Number(s.value) || 0, 5000)));
      return;
    case "switch_tab": {
      const handles = await driver.getAllWindowHandles();
      const idx =
        s.value === "first"
          ? 0
          : s.value === undefined || s.value === "last"
            ? handles.length - 1
            : Number(s.value);
      const h = handles[idx];
      if (!h) throw new Error(`no tab at index ${String(s.value)}`);
      await driver.switchTo().window(h);
      return;
    }
    case "scroll":
      if (!s.target) {
        await driver.executeScript(
          `const d = arguments[0]; if (d === "top") window.scrollTo(0, 0); else if (d === "bottom") window.scrollTo(0, document.documentElement.scrollHeight); else window.scrollBy(0, (d === "up" ? -1 : 1) * window.innerHeight * 0.8);`,
          s.value ?? "down",
        );
        return;
      }
  }
  // Re-rendering pages replace elements between lookup and action; an expert retries the whole
  // lookup-and-act on a stale reference (plain scripts do not).
  for (let attempt = 0; ; attempt++) {
    try {
      await actOnElement(driver, s, waitMs, strong);
      return;
    } catch (e) {
      const stale = e instanceof Error && e.name === "StaleElementReferenceError";
      if (!(strong && stale) || attempt >= 2) throw e;
    }
  }
}

async function actOnElement(
  driver: WebDriver,
  s: Spec,
  waitMs: number,
  strong: boolean,
): Promise<void> {
  await inFrameContext(driver, s.target, waitMs, async (inner) => {
    const el = await find(driver, inner!, waitMs);
    if (strong && s.op !== "scroll") {
      // Custom controls styled with opacity 0 (TodoMVC's toggle-all) are "not displayed" to WebDriver;
      // an expert clicks them from script.
      if (s.op === "click" && !(await el.isDisplayed())) {
        await driver.executeScript("arguments[0].click()", el);
        return;
      }
      await driver.wait(until.elementIsVisible(el), waitMs);
      await driver.wait(until.elementIsEnabled(el), waitMs).catch(() => undefined);
    }
    switch (s.op) {
      case "fill":
        await el.clear();
        await el.sendKeys(s.value ?? "");
        break;
      case "click":
        await el.click();
        break;
      case "press":
        await el.sendKeys(
          (selenium.Key as unknown as Record<string, string>)[(s.value ?? "").toUpperCase()] ??
            s.value ??
            "",
        );
        break;
      case "dblclick":
        await driver.actions().doubleClick(el).perform();
        break;
      case "hover":
        await driver.actions().move({ origin: el }).perform();
        break;
      case "uncheck":
        if (await el.isSelected()) await el.click();
        break;
      case "check":
        if (!(await el.isSelected())) await el.click();
        break;
      case "upload":
        await el.sendKeys(s.value ?? "");
        break;
      case "scroll":
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'})", el);
        break;
      case "drag": {
        const dst = await find(driver, s.to!, waitMs);
        // Plain WebDriver pointer actions do not trigger HTML5 drag events reliably; expert suites
        // dispatch the drag events from script.
        if (strong) await driver.executeScript(JS_DRAG, el, dst);
        else await driver.actions().dragAndDrop(el, dst).perform();
        break;
      }
      default:
        throw new Error(`op ${s.op} is not implemented in the Selenium baseline`);
    }
  });
}

/**
 * sel-trust: Selenium with the usual implicit wait and no assertions; success = no exception.
 * Counterpart of pw-trust.
 */
export class SelTrust extends SeleniumBase {
  id = "sel-trust";
  description = "Selenium, 5 s implicit wait, no assertions; success = no exception.";
  async run(sc: Scenario, baseUrl: string): Promise<DriverOutcome> {
    await this.reset();
    await this.driver.manage().setTimeouts({ implicit: DEFAULT_TIMEOUT });
    let actions = 0;
    try {
      for (const s of sc.steps) {
        actions++;
        await act(this.driver, s, baseUrl, 0, false);
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
    }
  }
}

function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e))
    .split("\n")
    .slice(0, 2)
    .join(" | ")
    .slice(0, 300);
}

async function assertUi(driver: WebDriver, v: Verifier, timeout: number): Promise<void> {
  switch (v.type) {
    case "text": {
      await driver.wait(
        async () => {
          const text = v.target
            ? await inFrameContext(driver, v.target, 300, async (inner) =>
                (await find(driver, inner!, 300)).getText(),
              ).catch(() => null)
            : await driver.findElement(By.css("body")).getText();
          if (text === null) return false;
          return v.equals !== undefined
            ? text.trim() === v.equals
            : text.includes(v.contains ?? "");
        },
        timeout,
        `text check failed (${JSON.stringify(v)})`,
      );
      return;
    }
    case "value":
      await driver.wait(
        async () =>
          (await inFrameContext(driver, v.target, 300, async (inner) =>
            (await find(driver, inner!, 300)).getAttribute("value"),
          ).catch(() => null)) === v.equals,
        timeout,
        "value check failed",
      );
      return;
    case "state":
      await driver.wait(
        async () => {
          const el = await find(driver, v.target, 300).catch(() => undefined);
          if (v.state === "hidden") return !el || !(await el.isDisplayed());
          if (!el) return false;
          if (v.state === "visible") return el.isDisplayed();
          if (v.state === "enabled") return el.isEnabled();
          if (v.state === "disabled") return !(await el.isEnabled());
          return el.isSelected();
        },
        timeout,
        "state check failed",
      );
      return;
    case "url":
      await driver.wait(
        async () => {
          const url = await driver.getCurrentUrl();
          return v.matches.length >= 3 && v.matches.startsWith("/") && v.matches.endsWith("/")
            ? new RegExp(v.matches.slice(1, -1)).test(url)
            : url.includes(v.matches);
        },
        timeout,
        "url check failed",
      );
      return;
    default:
      return;
  }
}

interface Logged {
  method: string;
  url: string;
  status: number;
  json?: unknown;
}

async function assertNetwork(
  driver: WebDriver,
  v: Extract<Verifier, { type: "network" }>,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const log = ((await driver.executeScript("return window.__vlog || []")) as Logged[]) ?? [];
    const hit = log.filter(
      (e) => e.url.includes(v.urlPattern) && (!v.method || e.method === v.method.toUpperCase()),
    );
    if (hit.length) {
      const last = hit[hit.length - 1]!;
      const ok =
        v.status === undefined || v.status === "2xx"
          ? last.status >= 200 && last.status < 300
          : last.status === v.status;
      if (!ok) throw new Error(`response ${last.status} for ${v.urlPattern}`);
      if (v.json) {
        const got = v.json.path
          .split(".")
          .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], last.json);
        if (got !== v.json.equals)
          throw new Error(
            `json ${v.json.path}=${JSON.stringify(got)} expected ${JSON.stringify(v.json.equals)}`,
          );
      }
      return;
    }
    if (Date.now() > deadline)
      throw new Error(`no ${v.method ?? ""} ${v.urlPattern} response seen`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function assertApi(
  v: Extract<Verifier, { type: "api" }>,
  baseUrl: string,
  timeout: number,
): Promise<void> {
  const url = new URL(v.get, baseUrl).toString();
  const deadline = Date.now() + timeout;
  for (;;) {
    const res = await fetch(url).catch(() => undefined);
    if (res?.ok) {
      const body = (await res.json()) as unknown;
      const items = Array.isArray(body) ? body : [body];
      if (
        items.some((it) =>
          Object.entries(v.matchesAny).every(
            ([k, val]) => (it as Record<string, unknown> | null)?.[k] === val,
          ),
        )
      )
        return;
    }
    if (Date.now() > deadline) throw new Error(`state probe ${v.get} did not show the effect`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * sel-strong: what an expert Selenium author writes: explicit waits (visible + enabled), UI
 * assertions with waits, a click-through of known interstitials, response assertions by
 * instrumenting fetch (Selenium has no first-class response assertion), and one whole-test retry.
 * No alternate locators and no state read-back. Counterpart of pw-strong.
 */
export class SelStrong extends SeleniumBase {
  id = "sel-strong";
  protected override promptBehavior = "accept" as const;
  description =
    "Expert Selenium: explicit waits, UI + fetch-instrumented response assertions, known-banner dismissal, 1 retry.";
  async run(sc: Scenario, baseUrl: string): Promise<DriverOutcome> {
    let actions = 0;
    let lastDiag = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.reset();
      await this.driver.manage().setTimeouts({ implicit: 0 });
      try {
        for (const s of sc.steps) {
          const timeout = s.timeoutMs ?? DEFAULT_TIMEOUT;
          // Requests made inside an iframe are logged (and read) in that frame's own window.
          const inFrame = <T>(fn: () => Promise<T>): Promise<T> =>
            s.target && "inFrame" in s.target
              ? inFrameContext(this.driver, s.target, timeout, async () => fn())
              : fn();
          if (s.op !== "goto") {
            // Known interstitials: dismiss when present (the Selenium counterpart of a locator handler).
            for (const d of s.dismiss ?? []) {
              const els = await this.driver.findElements(By.xpath(xpaths(d, false).join(" | ")));
              for (const el of els)
                if (await el.isDisplayed().catch(() => false))
                  await el.click().catch(() => undefined);
            }
            await inFrame(() => this.driver.executeScript(INSTALL_FETCH_LOG));
          }
          actions++;
          await act(this.driver, s, baseUrl, timeout, true);
          for (const v of s.postconditions ?? []) {
            if (v.type === "network") await inFrame(() => assertNetwork(this.driver, v, timeout));
            else if (v.type === "api") await assertApi(v, baseUrl, timeout);
            else await assertUi(this.driver, v, timeout);
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
