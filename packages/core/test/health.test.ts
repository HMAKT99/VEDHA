import { describe, expect, it } from "vitest";
import { AdapterError } from "../src/adapter.js";
import { Session } from "../src/session.js";
import type { ActionSpec, NetworkEntry, Policy } from "../src/types.js";
import { FakeAdapter, key } from "./fakeAdapter.js";

const btn = { role: "button", name: "Place order" } as const;
const status = { role: "status" } as const;
const URL_ORDERS = "http://app.test/api/orders";

const entry = (method: string, url: string, st: number): NetworkEntry => ({
  method,
  url,
  status: st,
});

async function run(
  setup: (a: FakeAdapter) => void,
  spec: Partial<ActionSpec> = {},
  policy: Policy = {},
) {
  const a = new FakeAdapter();
  a.texts.set(key(status), "Order placed");
  a.queue(btn, () => setup(a));
  const s = await Session.create(a, policy);
  return s.step({
    id: "submit",
    intent: "place the order",
    op: "click",
    target: btn,
    timeoutMs: 100,
    mutating: true,
    postconditions: [{ type: "text", target: status, contains: "Order placed" }],
    ...spec,
  });
}

describe("page-health check", () => {
  it("also converts an unknown outcome into a failure when the page reported a server error", async () => {
    class ErroringAdapter extends FakeAdapter {
      override async perform(): Promise<void> {
        this.net.push(entry("POST", URL_ORDERS, 500));
        throw new AdapterError("timeout", "Timeout; performing click action", true);
      }
    }
    const a = new ErroringAdapter();
    const s = await Session.create(a, {});
    const r = await s.step({
      id: "submit",
      intent: "place",
      op: "click",
      target: btn,
      mutating: true,
      timeoutMs: 100,
    });
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("health_check_failed");
    expect(r.error?.message).toContain("the outcome could not be observed");
  });

  it("fails a mutating step whose UI check passed but whose request returned 500", async () => {
    const r = await run((a) => a.net.push(entry("POST", URL_ORDERS, 500)));
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("health_check_failed");
    expect(r.error?.message).toContain("declared checks passed");
    expect(r.error?.message).toContain("POST /api/orders returned 500");
  });

  it("also catches it when no postcondition was declared", async () => {
    const r = await run((a) => a.net.push(entry("POST", URL_ORDERS, 500)), {
      postconditions: [],
    });
    expect(r.status).toBe("failed");
    expect(r.error?.message).toContain("no check was declared");
  });

  it("fails on a rejected write (4xx on POST) but ignores a 404 on a GET", async () => {
    const rejected = await run((a) => a.net.push(entry("POST", URL_ORDERS, 422)));
    expect(rejected.status).toBe("failed");
    const noise = await run((a) => a.net.push(entry("GET", "http://app.test/favicon.ico", 404)));
    expect(noise.status).toBe("verified");
  });

  it("fails on an uncaught page exception and ignores aborted requests", async () => {
    const boom = await run((a) =>
      a.events.push({ kind: "pageerror", text: "TypeError: x is undefined" }),
    );
    expect(boom.status).toBe("failed");
    expect(boom.error?.message).toContain("uncaught page error");
    const aborted = await run((a) =>
      a.events.push({
        kind: "requestfailed",
        method: "POST",
        url: URL_ORDERS,
        text: "net::ERR_ABORTED",
      }),
    );
    expect(aborted.status).toBe("verified");
  });

  it("exempts endpoints the step verifies explicitly or lists in healthIgnore", async () => {
    const declared = await run((a) => a.net.push(entry("POST", URL_ORDERS, 409)), {
      postconditions: [
        { type: "text", target: status, contains: "Order placed" },
        { type: "network", method: "POST", urlPattern: "/api/orders", status: 409 },
      ],
    });
    expect(declared.error?.code).not.toBe("health_check_failed");
    const ignored = await run((a) => a.net.push(entry("POST", "http://app.test/track", 500)), {
      healthIgnore: ["/track"],
    });
    expect(ignored.status).toBe("verified");
  });

  it("applies to mutating steps by default, to all steps with health: all, and never when off", async () => {
    const bad = (a: FakeAdapter) => a.net.push(entry("GET", "http://app.test/api/items", 503));
    expect((await run(bad, { mutating: false })).status).toBe("verified");
    expect((await run(bad, { mutating: false }, { health: "all" })).status).toBe("failed");
    const post = (a: FakeAdapter) => a.net.push(entry("POST", URL_ORDERS, 500));
    expect((await run(post, {}, { health: "off" })).status).toBe("verified");
  });
});

describe("request summary", () => {
  it("lists writes and failures, not ordinary reads", async () => {
    const r = await run((a) => {
      a.net.push(entry("GET", "http://app.test/api/items", 200));
      a.net.push(entry("POST", URL_ORDERS, 201));
      a.net.push(entry("GET", "http://app.test/favicon.ico", 404));
    });
    expect(r.requests).toEqual(["POST /api/orders 201", "GET /favicon.ico 404"]);
  });
});

describe("writes count as mutating even when unmarked", () => {
  it("fails an unmarked step whose write returned 500 and reports it", async () => {
    const r = await run((a) => a.net.push(entry("POST", URL_ORDERS, 500)), { mutating: false });
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("health_check_failed");
    expect(r.requests).toEqual(["POST /api/orders 500"]);
  });

  it("the repeat guard also protects an unmarked step that wrote", async () => {
    const { RepeatGuard } = await import("../src/repeatGuard.js");
    const a = new FakeAdapter();
    a.pending = 0;
    a.texts.set(key(status), "not yet");
    a.queue(btn, () => a.net.push(entry("POST", URL_ORDERS, 201)));
    const s = await Session.create(a, { readback: "off" });
    const spec: ActionSpec = {
      id: "go",
      intent: "place the order",
      op: "click",
      target: btn,
      timeoutMs: 100,
      postconditions: [{ type: "text", target: status, contains: "Order placed" }],
    };
    const r = await s.step(spec);
    const g = new RepeatGuard();
    g.record(spec, r);
    expect(g.refuses({ ...spec, id: "again" })).toContain("refused");
  });
});
