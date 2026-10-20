import path from "node:path";
import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserContext, FrameLocator, Locator, Page, Route } from "playwright";
import { AdapterError, Session, pollUntil, urlAllowed } from "@vedha/core";
import type {
  ActionOp,
  BrowserAdapter,
  ElementStateName,
  NetworkEntry,
  ObservationLevel,
  PageEvent,
  PageHeader,
  Policy,
  RawObservation,
  Target,
} from "@vedha/core";

export { runGeneratedSpec, runGeneratedSpecRepeated } from "./replayCheck.js";

const ANSI = /\u001b\[[0-9;]*m/g;
const MAX_JSON_BYTES = 200_000;

/** Maps a Playwright error to an AdapterError, based on messages observed in research/ (E-040/41/43). */
export function classifyError(e: unknown): AdapterError {
  const err = e as { name?: string; message?: string };
  const raw = (err?.message ?? String(e)).replace(ANSI, "");
  const m = raw.length > 900 ? raw.slice(0, 900) + "…" : raw;
  if (/ERR_BLOCKED_BY_CLIENT/.test(raw)) return new AdapterError("policy_blocked", m);
  if (/strict mode violation/.test(raw)) return new AdapterError("strict_violation", m);
  if (
    /Element is not an <input>, <textarea> or \[contenteditable\]|Element is not a <select>|Not a checkbox or radio button|Input of type "[^"]+" cannot be filled/.test(
      raw,
    )
  ) {
    return new AdapterError("invalid_action", m);
  }
  if (
    /Target (page, context or browser )?(has been )?closed|browser has been closed|Browser closed/i.test(
      raw,
    )
  ) {
    return new AdapterError("disconnected", m);
  }
  if (err?.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(raw)) {
    const dispatched = /performing \w+ action/.test(raw);
    if (/intercepts pointer events/.test(raw))
      return new AdapterError("blocked_by_overlay", m, dispatched);
    if (
      /locator resolved to/.test(raw) &&
      /element is not (visible|enabled|stable|editable|inert)|outside of the viewport/.test(raw)
    ) {
      return new AdapterError("not_actionable", m, dispatched);
    }
    if (!/locator resolved to/.test(raw) && /waiting for/.test(raw))
      return new AdapterError("not_found", m, dispatched);
    return new AdapterError("timeout", m, dispatched);
  }
  return new AdapterError("other", m);
}

type AriaPage = {
  ariaSnapshot(o: { mode: "ai"; boxes?: boolean; timeout?: number }): Promise<string>;
};

export interface LaunchOptions {
  browser?: "chromium" | "firefox" | "webkit";
  headless?: boolean;
  viewport?: { width: number; height: number };
}

export class PlaywrightAdapter implements BrowserAdapter {
  readonly name = "playwright";
  readonly version: string;
  private readonly net: NetworkEntry[] = [];
  private readonly events: PageEvent[] = [];
  private readonly inflight = new Set<unknown>();
  /** Per-tab main-document status and console counts since its last navigation. */
  private readonly pageInfo = new WeakMap<
    Page,
    { status?: number; errors: number; warnings: number }
  >();
  private policy: Policy = {};
  private origin?: string;

  private active: Page;
  private readonly pages: Page[] = [];

  /** The tab actions and observations apply to (the last one switched to, else the first). */
  get page(): Page {
    if (!this.active.isClosed()) return this.active;
    return this.pages.filter((p) => !p.isClosed()).at(-1) ?? this.active;
  }

  private constructor(
    firstPage: Page,
    private readonly context: BrowserContext,
    private readonly browser: Browser | undefined,
    version: string,
  ) {
    this.version = version;
    this.active = firstPage;
    const watch = (p: Page) => {
      this.pages.push(p);
      const info: { status?: number; errors: number; warnings: number } = {
        errors: 0,
        warnings: 0,
      };
      this.pageInfo.set(p, info);
      p.on("response", (res) => {
        if (res.request().isNavigationRequest() && res.frame() === p.mainFrame()) {
          info.status = res.status();
          info.errors = 0;
          info.warnings = 0;
        }
      });
      p.on("console", (m) => {
        if (m.type() === "error") info.errors++;
        else if (m.type() === "warning") info.warnings++;
      });
      p.on("dialog", (d) => {
        this.events.push({ kind: "dialog", text: `${d.type()}: ${d.message()}`.slice(0, 200) });
        const handled = this.policy.dialogs === "accept" ? d.accept() : d.dismiss();
        // Another handler (e.g. the caller's own test) may have settled it first.
        handled.catch(() => undefined);
      });
    };
    watch(firstPage);
    context.on("page", (p) => {
      watch(p);
      this.events.push({ kind: "popup", text: `tab ${this.pages.length - 1} opened` });
    });
    context.on("request", (req) => this.inflight.add(req));
    context.on("requestfinished", (req) => this.inflight.delete(req));
    context.on("requestfailed", (req) => {
      this.inflight.delete(req);
      this.events.push({
        kind: "requestfailed",
        method: req.method(),
        url: req.url(),
        text: req.failure()?.errorText ?? "request failed",
      });
    });
    context.on("weberror", (we) => {
      this.events.push({ kind: "pageerror", text: String(we.error().message ?? we.error()) });
    });
    context.on("response", (res) => {
      const entry: NetworkEntry = {
        method: res.request().method(),
        url: res.url(),
        status: res.status(),
      };
      this.net.push(entry);
      const post = res.request().postData();
      if (post && post.length <= MAX_JSON_BYTES) {
        try {
          entry.requestJson = JSON.parse(post);
        } catch {
          /* not JSON */
        }
      }
      const ct = res.headers()["content-type"] ?? "";
      if (ct.includes("json")) {
        void res
          .body()
          .then((b) => {
            if (b.length <= MAX_JSON_BYTES) entry.json = JSON.parse(b.toString("utf8"));
          })
          .catch(() => undefined);
      }
    });
  }

  static async launch(opts: LaunchOptions = {}): Promise<PlaywrightAdapter> {
    const type = { chromium, firefox, webkit }[opts.browser ?? envBrowser()];
    const browser = await type.launch({ headless: opts.headless ?? true });
    const context = await browser.newContext({
      viewport: opts.viewport ?? { width: 1000, height: 800 },
      // Service workers can serve/fetch outside route(); block them (use fromPage with care).
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    return new PlaywrightAdapter(page, context, browser, browser.version());
  }

  /** Wraps an existing Playwright page (additive adoption inside existing tests). */
  static fromPage(page: Page): PlaywrightAdapter {
    return new PlaywrightAdapter(
      page,
      page.context(),
      undefined,
      page.context().browser()?.version() ?? "unknown",
    );
  }

  /** URLs aborted by policy before any request was sent (informational). */
  readonly blockedUrls: string[] = [];
  /** URLs that actually produced a response despite policy (backstop; sticky: further actions are refused). */
  readonly violations: string[] = [];

  async applyPolicy(policy: Policy): Promise<void> {
    this.policy = policy;
    if (!policy.allowedDomains?.length) return;
    // Playwright does not re-invoke route handlers for redirect hops, so every hop is validated here
    // (research E-080: a 302 from an allowed host to a disallowed host was NOT blocked by a plain route).
    const handle = async (route: Route): Promise<void> => {
      const req = route.request();
      const url = req.url();
      if (!urlAllowed(url, policy).allowed) {
        this.blockedUrls.push(url);
        return route.abort("blockedbyclient");
      }
      let resp;
      try {
        resp = await route.fetch({ maxRedirects: 0 });
      } catch {
        return route.continue();
      }
      if (!isRedirect(resp.status(), resp.headers()["location"])) {
        return route.fulfill({ response: resp });
      }
      const idempotent = req.method() === "GET" || req.method() === "HEAD";
      let hop = new URL(resp.headers()["location"]!, url);
      for (let hops = 0; ; hops++) {
        if (!urlAllowed(hop.href, policy).allowed || hops > 10) {
          this.blockedUrls.push(hop.href);
          return route.abort("blockedbyclient");
        }
        const next = await this.context.request
          .fetch(hop.href, { method: "GET", maxRedirects: 0 })
          .catch(() => undefined);
        const nloc = next?.headers()["location"];
        if (!next || !isRedirect(next.status(), nloc)) {
          // Chain fully validated. GET/HEAD: let the browser follow it itself (URL stays correct).
          // Non-idempotent request (already sent once): never re-send it; serve the validated final
          // response instead. Known cost: the page URL stays at the POST URL.
          return idempotent ? route.continue() : route.fulfill({ response: next ?? resp });
        }
        hop = new URL(nloc!, hop);
      }
    };
    // A page or context can close while a request is in flight; the resulting rejection (for example
    // "Fetch response has been disposed") must never escape as an unhandled promise rejection.
    await this.context.route("**/*", (route) =>
      handle(route).catch(() => route.abort().catch(() => undefined)),
    );
    // WebSockets are not covered by route(): gate them explicitly.
    await this.context.routeWebSocket(/.*/, (ws) => {
      if (!urlAllowed(ws.url(), policy).allowed) {
        this.blockedUrls.push(ws.url());
        void ws.close({ code: 1008, reason: "blocked by policy" });
        return;
      }
      ws.connectToServer();
    });
    this.context.on("response", (res) => {
      if (!urlAllowed(res.url(), policy).allowed && !this.violations.includes(res.url()))
        this.violations.push(res.url());
    });
  }

  private locate(t: Target, root: Page | Locator | FrameLocator = this.page): Locator {
    if ("within" in t) return this.locate(t.target, this.locate(t.within, root));
    if ("inFrame" in t) return this.locate(t.target, root.frameLocator(t.inFrame));
    if ("role" in t) {
      return root.getByRole(t.role as Parameters<Page["getByRole"]>[0], {
        name: t.name,
        exact: t.exact,
      });
    }
    if ("testId" in t) return root.getByTestId(t.testId);
    if ("css" in t) return root.locator(t.css);
    if ("label" in t) return root.getByLabel(t.label, { exact: t.exact });
    if ("text" in t) return root.getByText(t.text, { exact: t.exact });
    return this.page.locator(`aria-ref=${t.ref}`);
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    await this.perform("goto", undefined, url, timeoutMs);
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async perform(
    op: ActionOp,
    target: Target | undefined,
    value: string | undefined,
    timeoutMs: number,
    extra: { to?: Target } = {},
  ): Promise<void> {
    try {
      if (this.violations.length)
        throw new AdapterError("policy_blocked", `policy violation: reached ${this.violations[0]}`);
      if (op === "goto") {
        const url = value ?? "/";
        const verdict = urlAllowed(
          new URL(url, this.page.url() === "about:blank" ? undefined : this.page.url()).toString(),
          this.policy,
        );
        if (!verdict.allowed) throw new AdapterError("policy_blocked", verdict.reason ?? "blocked");
        await this.page.goto(url, { timeout: timeoutMs });
        const u = new URL(this.page.url());
        if (u.protocol.startsWith("http")) this.origin = u.origin;
        return;
      }
      const loc = target ? this.locate(target) : undefined;
      switch (op) {
        case "click":
          await need(loc, op).click({ timeout: timeoutMs });
          break;
        case "fill":
          await need(loc, op).fill(value ?? "", { timeout: timeoutMs });
          break;
        case "select":
          await need(loc, op).selectOption(value ?? "", { timeout: timeoutMs });
          break;
        case "check":
          await need(loc, op).check({ timeout: timeoutMs });
          break;
        case "press":
          if (loc) await loc.press(value ?? "", { timeout: timeoutMs });
          else await this.page.keyboard.press(value ?? "");
          break;
        case "dblclick":
          await need(loc, op).dblclick({ timeout: timeoutMs });
          break;
        case "hover":
          await need(loc, op).hover({ timeout: timeoutMs });
          break;
        case "uncheck":
          await need(loc, op).uncheck({ timeout: timeoutMs });
          break;
        case "upload":
          await need(loc, op).setInputFiles(this.uploadFiles(value), { timeout: timeoutMs });
          break;
        case "scroll":
          if (loc) await loc.scrollIntoViewIfNeeded({ timeout: timeoutMs });
          else await this.scrollPage(value);
          break;
        case "drag": {
          if (!extra.to)
            throw new AdapterError("invalid_action", "drag requires a destination target (to)");
          await need(loc, op).dragTo(this.locate(extra.to), { timeout: timeoutMs });
          break;
        }
        case "wait":
          await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(value) || 0, 0), 5000)));
          break;
        case "back":
          await this.page.goBack({ timeout: timeoutMs });
          break;
        case "reload":
          await this.page.reload({ timeout: timeoutMs });
          break;
        case "switch_tab":
          await this.switchTab(value);
          break;
      }
    } catch (e) {
      throw e instanceof AdapterError ? e : classifyError(e);
    }
  }

  private uploadFiles(value: string | undefined): string[] {
    const roots = (this.policy.uploadRoots ?? []).map((r) => path.resolve(r));
    if (!roots.length)
      throw new AdapterError(
        "policy_blocked",
        "uploads are disabled: set policy.uploadRoots to the directories files may be read from",
      );
    const files = (value ?? "")
      .split(",")
      .map((f) => path.resolve(f.trim()))
      .filter((f) => f !== path.resolve(""));
    if (!files.length) throw new AdapterError("invalid_action", "upload requires a file path");
    for (const f of files) {
      if (!roots.some((r) => f === r || f.startsWith(r + path.sep)))
        throw new AdapterError("policy_blocked", `upload path is outside policy.uploadRoots: ${f}`);
    }
    return files;
  }

  private async scrollPage(value: string | undefined): Promise<void> {
    const dir = value ?? "down";
    await this.page.evaluate((d) => {
      const h = window.innerHeight * 0.8;
      if (d === "top") window.scrollTo(0, 0);
      else if (d === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
      else window.scrollBy(0, d === "up" ? -h : h);
    }, dir);
  }

  private async switchTab(value: string | undefined): Promise<void> {
    // A click that opens a tab returns slightly before the tab is registered; give it a moment.
    if (
      (value === undefined || value === "last") &&
      this.pages.filter((p) => !p.isClosed()).length === 1
    )
      await this.context.waitForEvent("page", { timeout: 1500 }).catch(() => undefined);
    const open = this.pages.filter((p) => !p.isClosed());
    const idx =
      value === "first"
        ? 0
        : value === undefined || value === "last"
          ? open.length - 1
          : Number(value);
    const tab = open[idx];
    if (!tab)
      throw new AdapterError(
        "not_found",
        `no open tab at index ${String(value)} (${open.length} open)`,
      );
    this.active = tab;
    await tab.bringToFront();
  }

  async elementState(target: Target, state: ElementStateName, timeoutMs: number): Promise<boolean> {
    const loc = this.locate(target);
    try {
      if (state === "visible" || state === "hidden") {
        await loc.waitFor({ state, timeout: timeoutMs });
        return true;
      }
      const ok = await pollUntil(async () => {
        const v =
          state === "enabled"
            ? await loc.isEnabled({ timeout: 300 })
            : state === "disabled"
              ? await loc.isDisabled({ timeout: 300 })
              : await loc.isChecked({ timeout: 300 });
        return v ? true : undefined;
      }, timeoutMs);
      return ok === true;
    } catch {
      return false;
    }
  }

  async text(target: Target | undefined, timeoutMs: number): Promise<string | null> {
    try {
      const loc = target ? this.locate(target) : this.page.locator("body");
      return await loc.innerText({ timeout: timeoutMs });
    } catch {
      return null;
    }
  }

  async value(target: Target, timeoutMs: number): Promise<string | null> {
    try {
      return await this.locate(target).inputValue({ timeout: timeoutMs });
    } catch {
      return null;
    }
  }

  networkLog(): NetworkEntry[] {
    return this.net;
  }

  pageEvents(): PageEvent[] {
    return this.events;
  }

  pendingRequests(): number {
    return this.inflight.size;
  }

  async pageHeader(): Promise<PageHeader> {
    const open = this.pages.filter((p) => !p.isClosed());
    const current = this.page;
    const tabs = await Promise.all(
      open.map(async (p, index) => ({
        index,
        url: p.url(),
        title: await p.title().catch(() => ""),
        current: p === current,
      })),
    );
    const info = this.pageInfo.get(current);
    return {
      tabs,
      mainStatus: info?.status,
      consoleErrors: info?.errors ?? 0,
      consoleWarnings: info?.warnings ?? 0,
    };
  }

  async fetchJson(path: string): Promise<{ status: number; body: unknown }> {
    const base = this.origin ?? this.page.url();
    const url = new URL(path, base).toString();
    const verdict = urlAllowed(url, this.policy);
    if (!verdict.allowed) throw new AdapterError("policy_blocked", verdict.reason ?? "blocked");
    const res = await this.context.request.get(url);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    return { status: res.status(), body };
  }

  async observe(opts: {
    level: ObservationLevel;
    ref?: string;
    maxChars: number;
  }): Promise<RawObservation> {
    const detail = { mode: "ai" as const, boxes: opts.level === "detail", timeout: 5000 };
    const outline = opts.ref
      ? await (this.page.locator(`aria-ref=${opts.ref}`) as unknown as AriaPage).ariaSnapshot(
          detail,
        )
      : await (this.page as unknown as AriaPage).ariaSnapshot(detail);
    return { url: this.page.url(), title: await this.page.title(), outline };
  }

  async screenshot(): Promise<Uint8Array | undefined> {
    try {
      return await this.page.screenshot();
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    if (this.browser) await this.browser.close();
  }
}

function envBrowser(): "chromium" | "firefox" | "webkit" {
  const v = process.env.VEDHA_BROWSER;
  return v === "firefox" || v === "webkit" ? v : "chromium";
}

function isRedirect(status: number, location: string | undefined): boolean {
  return status >= 300 && status < 400 && !!location;
}

function need(loc: Locator | undefined, op: string): Locator {
  if (!loc) throw new AdapterError("other", `${op} requires a target`);
  return loc;
}

/** Convenience: launch Chromium and open a Session. */
export async function openSession(policy: Policy = {}, opts: LaunchOptions = {}): Promise<Session> {
  return Session.create(await PlaywrightAdapter.launch(opts), policy);
}

/** Wrap an existing Playwright page in a Session. */
export async function sessionFromPage(page: Page, policy: Policy = {}): Promise<Session> {
  return Session.create(PlaywrightAdapter.fromPage(page), policy);
}
