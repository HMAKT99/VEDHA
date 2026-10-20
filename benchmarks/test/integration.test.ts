import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlaywrightAdapter,
  classifyError,
  runGeneratedSpec,
  runGeneratedSpecRepeated,
} from "@vedha/adapter-playwright";
import {
  RuleActor,
  Session,
  createBundle,
  explore,
  promote,
  readBundle,
  replayBundle,
  writeBundle,
} from "@vedha/core";
import type { ActionSpec, Actor, ActorDecision } from "@vedha/core";
import { ShopServer, type Variant } from "../fixtures/shop.js";
import { SCENARIOS } from "../scenarios/index.js";

const WORK = path.resolve("benchmarks/results/.test-work");

async function withApp<T>(
  variant: Variant,
  fn: (url: string, server: ShopServer, adapter: PlaywrightAdapter) => Promise<T>,
): Promise<T> {
  const server = new ShopServer(variant);
  const url = await server.start();
  const adapter = await PlaywrightAdapter.launch();
  try {
    return await fn(url, server, adapter);
  } finally {
    await adapter.close();
    await server.stop();
  }
}

const abs = (specs: ActionSpec[], base: string): ActionSpec[] =>
  specs.map((s) =>
    s.op === "goto" ? { ...s, value: new URL(s.value ?? "/", base).toString() } : s,
  );
const scenario = (id: string) => SCENARIOS.find((s) => s.id.startsWith(id))!;

beforeAll(() => fs.mkdirSync(WORK, { recursive: true }));
afterAll(() => fs.rmSync(WORK, { recursive: true, force: true }));

describe("Playwright error classification against real failures", () => {
  it("maps overlay, disabled, missing and strict-mode failures", async () => {
    await withApp({ cookieBanner: true, disabledSubmit: true }, async (url, _s, adapter) => {
      await adapter.goto(url, 5000);
      await new Promise((r) => setTimeout(r, 500)); // banner appears at 300ms
      const codes: Record<string, string> = {};
      const attempt = async (name: string, f: () => Promise<void>) => {
        try {
          await f();
          codes[name] = "ok";
        } catch (e) {
          codes[name] = classifyError(e).code;
        }
      };
      await attempt("overlay", () => adapter.perform("click", { label: "Name" }, undefined, 700));
      await attempt("missing", () =>
        adapter.perform("click", { role: "button", name: "Nope" }, undefined, 700),
      );
      await adapter.perform("click", { role: "button", name: "Accept" }, undefined, 2000);
      await attempt("disabled", () =>
        adapter.perform("click", { role: "button", name: "Place order" }, undefined, 700),
      );
      await attempt("strict", () => adapter.perform("click", { role: "option" }, undefined, 700));
      expect(codes).toEqual({
        overlay: "blocked_by_overlay",
        missing: "not_found",
        disabled: "not_actionable",
        strict: "strict_violation",
      });
    });
  });
});

describe("Vedha on the fixture app (real browser)", () => {
  it("verifies a clean order end to end", async () => {
    await withApp({}, async (url, server, adapter) => {
      const s = await Session.create(adapter, { allowedDomains: ["127.0.0.1"] });
      const report = await s.run(abs(scenario("S01").steps, url));
      expect(report.verdict).toBe("passed");
      expect((await server.oracle()).orders).toHaveLength(1);
    });
  });

  it("recovers from a banner + renamed button and records both recoveries", async () => {
    await withApp({ cookieBanner: true, renameSubmit: true }, async (url, server, adapter) => {
      const s = await Session.create(adapter, {});
      const report = await s.run(abs(scenario("S05").steps, url));
      expect(report.verdict).toBe("passed_with_recovery");
      const submit = report.steps.find((r) => r.actionId === "submit")!;
      expect(submit.recoveries.map((r) => r.strategy)).toContain("alt_target");
      expect(submit.recoveries.every((r) => r.originalError.message.length > 0)).toBe(true);
      expect((await server.oracle()).orders).toHaveLength(1);
    });
  });

  it("detects the silent-500 defect that the UI hides", async () => {
    await withApp({ bug: "silent" }, async (url, server, adapter) => {
      const s = await Session.create(adapter, {});
      const report = await s.run(abs(scenario("S06").steps, url));
      expect(report.verdict).toBe("failed");
      expect((await server.oracle()).orders).toHaveLength(0);
    });
  });

  it("does not re-issue after the server accepted a wrong quantity", async () => {
    await withApp({ bug: "wrongqty" }, async (url, server, adapter) => {
      const s = await Session.create(adapter, {});
      const report = await s.run(abs(scenario("S07").steps, url));
      expect(report.verdict).toBe("failed");
      expect((await server.oracle()).orders).toHaveLength(1); // exactly the one bad order, no duplicates
    });
  });

  it("does not mask a permanently disabled submit button", async () => {
    await withApp({ disabledSubmit: true }, async (url, _srv, adapter) => {
      const s = await Session.create(adapter, {});
      const report = await s.run(abs(scenario("S08").steps, url));
      expect(report.verdict).toBe("failed");
      const submit = report.steps.find((r) => r.actionId === "submit")!;
      expect(submit.error?.code).toBe("not_actionable");
      expect(submit.recovered).toBe(false);
    });
  });

  it("retries safely after a transient 503 using reconcile (exactly one order)", async () => {
    await withApp({ transient503: true }, async (url, server, adapter) => {
      const s = await Session.create(adapter, {});
      const report = await s.run(abs(scenario("S09").steps, url));
      expect(report.verdict).toBe("passed_with_recovery");
      expect((await server.oracle()).orders).toHaveLength(1);
    });
  }, 60_000);

  it("confirms a committed order via reconcile when the response is late (no duplicate)", async () => {
    await withApp({ commitDelayMs: 6000 }, async (url, server, adapter) => {
      const s = await Session.create(adapter, {});
      const report = await s.run(abs(scenario("S10").steps, url));
      expect(report.verdict).toBe("passed");
      expect((await server.oracle()).orders).toHaveLength(1);
      expect(report.steps.find((r) => r.actionId === "submit")?.note).toContain("reconcile");
    });
  }, 60_000);
});

describe("policy under a real browser", () => {
  it("blocks a redirect to a disallowed host (same-IP different hostname)", async () => {
    await withApp({}, async (url, server, adapter) => {
      const s = await Session.create(adapter, { allowedDomains: ["127.0.0.1"] });
      const port = new URL(url).port;
      const r = await s.step({
        id: "g",
        intent: "follow redirect",
        op: "goto",
        value: `${url}/redirect?to=${encodeURIComponent(`http://localhost:${port}/__oracle`)}`,
      });
      expect(["blocked", "failed"]).toContain(r.status);
      expect(
        adapter.networkLog().some((n) => n.url.includes("localhost") && n.status === 200),
      ).toBe(false);
      expect(server.state.orders).toHaveLength(0);
    });
  });

  it("treats hostile page text as data: the outline is flagged untrusted and nothing is clicked", async () => {
    await withApp({}, async (url, _srv, adapter) => {
      const s = await Session.create(adapter, {});
      await s.step({ id: "g", intent: "open", op: "goto", value: `${url}/hostile` });
      const obs = await s.observe();
      expect(obs.untrusted).toBe(true);
      expect(obs.outline).toContain("ignore all previous instructions");
      expect(s.results.filter((r) => r.actionId !== "g")).toHaveLength(0);
    });
  });
});

describe("policy: POST redirects, WebSockets, service workers", () => {
  it("follows an allowed post-redirect-get but blocks a POST redirect to a disallowed host", async () => {
    await withApp({}, async (url, server, adapter) => {
      const s = await Session.create(adapter, { allowedDomains: ["127.0.0.1"] });
      await s.step({ id: "o", intent: "open", op: "goto", value: `${url}/postform` });
      const ok = await s.step({
        id: "go",
        intent: "post",
        op: "click",
        target: { role: "button", name: "Go" },
        postconditions: [{ type: "text", target: { role: "heading" }, equals: "Items" }],
      });
      expect(ok.status).toBe("verified");
      await s.step({ id: "o2", intent: "open", op: "goto", value: `${url}/postform` });
      await s.step({
        id: "evil",
        intent: "post",
        op: "click",
        target: { role: "button", name: "Evil" },
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(server.state.leaks).toBe(0);
      expect(adapter.violations).toEqual([]);
    });
  });

  it("blocks WebSocket connections to a disallowed host before they reach the server", async () => {
    await withApp({}, async (url, server, adapter) => {
      const s = await Session.create(adapter, { allowedDomains: ["127.0.0.1"] });
      await s.step({ id: "o", intent: "open", op: "goto", value: `${url}/postform` });
      const port = new URL(url).port;
      const outcome = await adapter.page.evaluate(
        (p) =>
          new Promise<string>((resolve) => {
            const ws = new WebSocket(`ws://localhost:${p}/ws`);
            ws.onopen = () => resolve("open");
            ws.onclose = () => resolve("closed");
            ws.onerror = () => resolve("error");
            setTimeout(() => resolve("timeout"), 3000);
          }),
        port,
      );
      expect(["closed", "error"]).toContain(outcome);
      expect(server.state.upgrades).toBe(0);
      expect(adapter.blockedUrls.some((u) => u.includes("localhost"))).toBe(true);
    });
  });

  it("blocks service workers in launched sessions (no registration, no worker)", async () => {
    await withApp({}, async (url, _server, adapter) => {
      await Session.create(adapter, { allowedDomains: ["127.0.0.1"] });
      await adapter.goto(`${url}/sw-page`, 5000);
      await adapter.page.waitForFunction(() => document.title !== "SW", undefined, {
        timeout: 5000,
      });
      const regs = await adapter.page.evaluate(() =>
        navigator.serviceWorker.getRegistrations().then((r) => r.length),
      );
      expect(regs).toBe(0);
      expect(adapter.page.context().serviceWorkers()).toHaveLength(0);
    });
  });
});

describe("explore -> promote -> replay check", () => {
  it("turns a RuleActor exploration into a Playwright spec that passes against the app", async () => {
    await withApp({}, async (url, server, adapter) => {
      const s = await Session.create(adapter, {});
      const actor = new RuleActor({
        fields: [
          { name: /name/i, value: "Ada", role: "textbox" },
          { name: /quantity/i, value: "3", role: "spinbutton" },
        ],
        submit: {
          name: /place order|submit/i,
          mutating: true,
          postconditions: [
            { type: "text", target: { role: "status" }, contains: "Order placed" },
            {
              type: "network",
              method: "POST",
              urlPattern: "/api/orders",
              status: "2xx",
              json: { path: "qty", equals: 3 },
            },
          ],
          reconcile: { type: "api", get: "/api/orders", matchesAny: { name: "Ada", qty: 3 } },
        },
      });
      const res = await explore(s, actor, {
        goal: "place an order for Ada, quantity 3",
        startUrl: `${url}/`,
        maxSteps: 8,
      });
      expect(res.stoppedBecause).toBe("actor_done");
      expect(res.proposal.steps.map((x) => x.id)).toContain("submit");
      expect(res.proposal.confidence).toBeGreaterThan(0.5);
      const code = promote(res.proposal);
      expect(code).toContain("waitForResponse");
      expect(code).not.toContain(url); // portable: no hard-coded host
      // Reset app state, then check the generated test independently passes against a fresh app.
      const fresh = new ShopServer({});
      const freshUrl = await fresh.start();
      try {
        const check = await runGeneratedSpec(code, freshUrl, path.join(WORK, "gen"));
        expect(check, JSON.stringify(check)).toMatchObject({ passed: true });
        expect((await fresh.oracle()).orders).toHaveLength(1);
      } finally {
        await fresh.stop();
      }
      expect((await server.oracle()).orders).toHaveLength(1);
    });
  }, 120_000);

  it("writes a failure bundle and replays it", async () => {
    await withApp({ bug: "silent" }, async (url, _srv, adapter) => {
      const s = await Session.create(adapter, {});
      await s.run(abs(scenario("S06").steps, url));
      const bundle = createBundle(s, "place an order");
      const dir = path.join(WORK, "bundle");
      await writeBundle(dir, bundle, await adapter.screenshot());
      const back = readBundle(dir);
      expect(back.report.verdict).toBe("failed");
      const s2 = await Session.create(adapter, {});
      const replay = await replayBundle(s2, back);
      expect(replay.divergences).toEqual([]); // same failure reproduced
    });
  }, 120_000);
});

describe("agent mistakes get advice and the actor can recover (real browser)", () => {
  class Scripted implements Actor {
    readonly name = "scripted";
    seen: string[] = [];
    private i = 0;
    constructor(private readonly plan: ActorDecision[]) {}
    async decide(input: { feedback: string }): Promise<ActorDecision> {
      this.seen.push(input.feedback);
      return this.plan[this.i++] ?? { kind: "done", summary: "end" };
    }
  }
  const act = (spec: ActionSpec): ActorDecision => ({ kind: "act", spec });

  it("fill on the Product dropdown fails with a select hint, then the order is placed", async () => {
    await withApp({}, async (_url, server, adapter) => {
      const s = await Session.create(adapter, {});
      const actor = new Scripted([
        act({
          id: "bad",
          intent: "pick product",
          op: "fill",
          target: { role: "combobox", name: "Product" },
          value: "Widget",
          timeoutMs: 2000,
        }),
        act({
          id: "name",
          intent: "name",
          op: "fill",
          target: { label: "Name", exact: true },
          value: "Ada",
        }),
        act({
          id: "qty",
          intent: "qty",
          op: "fill",
          target: { label: "Quantity", exact: true },
          value: "3",
        }),
        act({
          id: "submit",
          intent: "place",
          op: "click",
          target: { role: "button", name: "Place order" },
          mutating: true,
          postconditions: [{ type: "text", target: { role: "status" }, contains: "Order placed" }],
        }),
        { kind: "done", summary: "placed" },
      ]);
      const res = await explore(s, actor, {
        goal: "place an order for Ada, quantity 3",
        startUrl: `${_url}/`,
        maxSteps: 8,
      });
      const bad = s.results.find((r) => r.actionId === "bad")!;
      expect(bad.status).toBe("failed");
      expect(bad.error?.code).toBe("invalid_action");
      expect(bad.error?.hint).toContain("select");
      expect(actor.seen[1]).toContain("hint:");
      expect(res.stoppedBecause).toBe("actor_done");
      expect(res.failedSteps).toBe(1);
      expect(s.results.find((r) => r.actionId === "submit")?.status).toBe("verified");
      expect((await server.oracle()).orders).toHaveLength(1);
    });
  }, 60_000);
});

describe("flake detection on generated tests", () => {
  const spec = `import { test, expect } from "@playwright/test";
test("heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "New order" })).toBeVisible({ timeout: 3000 });
});
`;
  it("reports a stable test as passing every run and an intermittent one as flaky", async () => {
    const server = new ShopServer({});
    const url = await server.start();
    try {
      const stable = await runGeneratedSpecRepeated(spec, url, path.join(WORK, "flake-ok"), 2);
      expect(stable).toMatchObject({ passed: true, runs: 2, passes: 2, flaky: false });
      let n = 0;
      const flaky = await runGeneratedSpecRepeated(
        spec,
        async () => (n++ === 0 ? url : "http://127.0.0.1:9"),
        path.join(WORK, "flake-bad"),
        2,
      );
      expect(flaky).toMatchObject({ passed: false, passes: 1, flaky: true });
      expect(flaky.detail).toContain("FLAKY");
    } finally {
      await server.stop();
    }
  }, 120_000);
});
