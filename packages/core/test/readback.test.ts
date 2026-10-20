import { describe, expect, it } from "vitest";
import { Session } from "../src/session.js";
import type { ActionSpec, NetworkEntry, Policy } from "../src/types.js";
import { FakeAdapter, key } from "./fakeAdapter.js";

const btn = { role: "button", name: "Save" } as const;
const status = { role: "status" } as const;

const write = (method: string, url: string, extra: Partial<NetworkEntry> = {}): NetworkEntry => ({
  method,
  url,
  status: 201,
  ...extra,
});

async function run(
  setup: (a: FakeAdapter) => void,
  spec: Partial<ActionSpec> = {},
  policy: Policy = {},
) {
  const a = new FakeAdapter();
  a.texts.set(key(status), "Saved");
  a.queue(btn, () => setup(a));
  const s = await Session.create(a, policy);
  const r = await s.step({
    id: "save",
    intent: "save",
    op: "click",
    target: btn,
    mutating: true,
    timeoutMs: 100,
    postconditions: [{ type: "text", target: status, contains: "Saved" }],
    ...spec,
  });
  return { a, r };
}

const ORDERS = "http://app.test/api/orders";

describe("read-back inference", () => {
  it("confirms a created item by its id", async () => {
    const { r } = await run((a) => {
      a.net.push(
        write("POST", ORDERS, { json: { id: 7, name: "Ada" }, requestJson: { name: "Ada" } }),
      );
      a.api.set("/api/orders", [{ id: 7, name: "Ada" }]);
    });
    expect(r.status).toBe("verified");
    expect(r.readback?.[0]).toContain("confirms POST /api/orders");
    expect(r.readbackProbes).toEqual([{ get: "/api/orders", matchesAny: { name: "Ada" } }]);
  });

  it("fails when the server said 2xx but the collection lacks the created id", async () => {
    const { r } = await run((a) => {
      a.net.push(write("POST", ORDERS, { json: { id: 7 }, requestJson: { name: "Ada" } }));
      a.api.set("/api/orders", [{ id: 1, name: "Bob" }]);
    });
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("readback_contradiction");
    expect(r.error?.hint).toContain("policy.readback");
  });

  it("catches a silent drop with no id: empty collection after a POST with a body", async () => {
    const { r } = await run((a) => {
      a.net.push(
        write("POST", "http://app.test/api/event", {
          status: 200,
          json: { ok: true },
          requestJson: { type: "laptops" },
        }),
      );
      a.api.set("/api/event", []);
    });
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("readback_contradiction");
  });

  it("finds the collection at the plural sibling when the write path has no GET", async () => {
    const dropped = await run((a) => {
      a.net.push(
        write("POST", "http://app.test/api/event", {
          status: 200,
          json: { ok: true },
          requestJson: { type: "laptops" },
        }),
      );
      a.apiStatus.set("/api/event", 404);
      a.api.set("/api/events", []);
    });
    expect(dropped.r.error?.code).toBe("readback_contradiction");
    expect(dropped.r.error?.message).toContain("/api/events");
    const kept = await run((a) => {
      a.net.push(
        write("POST", "http://app.test/api/event", {
          status: 200,
          requestJson: { type: "laptops" },
        }),
      );
      a.apiStatus.set("/api/event", 404);
      a.api.set("/api/events", [{ type: "laptops" }]);
    });
    expect(kept.r.status).toBe("verified");
    expect(kept.r.readback?.[0]).toContain("/api/events");
  });

  it("does not ask again about a path that already proved unsupported", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "Saved");
    let probes = 0;
    const orig = a.fetchJson.bind(a);
    a.fetchJson = async (p: string) => {
      probes++;
      return orig(p);
    };
    a.apiStatus.set("/api/orders", 404);
    a.apiStatus.set("/api/order", 404);
    a.queue(btn, () => a.net.push(write("POST", ORDERS, { requestJson: { name: "Ada" } })));
    const s = await Session.create(a, {});
    const step = (id: string): ActionSpec => ({
      id,
      intent: id,
      op: "click",
      target: btn,
      mutating: true,
      timeoutMs: 100,
      postconditions: [{ type: "text", target: status, contains: "Saved" }],
    });
    await s.step(step("one"));
    const first = probes;
    a.queue(btn, () => a.net.push(write("POST", ORDERS, { requestJson: { name: "Ada" } })));
    await s.step(step("two"));
    expect(first).toBe(2); // same path and sibling, once
    expect(probes).toBe(2); // not asked again
  });

  it("never probes authentication, GraphQL or tracking endpoints", async () => {
    for (const url of [
      "http://app.test/api/login",
      "http://app.test/graphql",
      "http://app.test/api/track",
    ]) {
      const { a, r } = await run((a) => {
        a.net.push(write("POST", url, { requestJson: { u: "ada" } }));
        a.api.set(new URL(url).pathname, []);
      });
      expect(r.status).toBe("verified");
      expect(a.performed.length).toBe(1);
    }
  });

  it("matches by the fields that were sent when there is no id", async () => {
    const { r } = await run((a) => {
      a.net.push(
        write("POST", "http://app.test/api/event", {
          status: 200,
          requestJson: { type: "laptops" },
        }),
      );
      a.api.set("/api/event", [{ type: "laptops" }]);
    });
    expect(r.status).toBe("verified");
  });

  it("makes no claim when the read-back is unsupported, other-schema, large, or not JSON", async () => {
    const cases: Array<(a: FakeAdapter) => void> = [
      (a) => a.apiStatus.set("/api/orders", 405),
      (a) => a.apiStatus.set("/api/orders", 404),
      (a) => a.api.set("/api/orders", [{ sku: "x" }, { sku: "y" }]), // other schema: no shared key
      (a) =>
        a.api.set(
          "/api/orders",
          Array.from({ length: 150 }, (_, i) => ({ id: i, name: "n" })),
        ),
      (a) => a.api.set("/api/orders", "<html>"),
    ];
    for (const extra of cases) {
      const { r } = await run((a) => {
        a.net.push(write("POST", ORDERS, { requestJson: { name: "Ada" } }));
        a.apiStatus.set("/api/order", 404); // a guessed sibling path that does not exist
        extra(a);
      });
      expect(r.status).toBe("verified");
    }
  });

  it("checks PUT/PATCH fields and DELETE absence", async () => {
    const put = await run((a) => {
      a.net.push(
        write("PUT", "http://app.test/api/orders/7", { status: 200, requestJson: { name: "Zed" } }),
      );
      a.api.set("/api/orders/7", { id: 7, name: "Ada" });
    });
    expect(put.r.error?.code).toBe("readback_contradiction");
    const del = await run((a) => {
      a.net.push(write("DELETE", "http://app.test/api/rows/2", { status: 204 }));
      a.api.set("/api/rows", [{ id: 1 }, { id: 2 }, { id: 3 }]);
    });
    expect(del.r.error?.code).toBe("readback_contradiction");
    const ok = await run((a) => {
      a.net.push(write("DELETE", "http://app.test/api/rows/2", { status: 204 }));
      a.api.set("/api/rows", [{ id: 1 }, { id: 3 }]);
    });
    expect(ok.r.status).toBe("verified");
  });

  it("never runs for failed writes, non-mutating steps, opt-out, healthIgnore or declared endpoints", async () => {
    const drop = (a: FakeAdapter) => {
      a.net.push(write("POST", ORDERS, { requestJson: { name: "Ada" } }));
      a.api.set("/api/orders", []);
    };
    expect((await run(drop, { mutating: false })).r.status).toBe("verified");
    expect((await run(drop, {}, { readback: "off" })).r.status).toBe("verified");
    expect((await run(drop, { healthIgnore: ["/api/orders"] })).r.status).toBe("verified");
    // A declared 2xx network check validates the response, not persistence: read-back still runs.
    expect(
      (
        await run(drop, {
          postconditions: [
            { type: "text", target: status, contains: "Saved" },
            { type: "network", method: "POST", urlPattern: "/api/orders", status: "2xx" },
          ],
        })
      ).r.error?.code,
    ).toBe("readback_contradiction");
    const failed = await run((a) => {
      a.net.push(write("POST", ORDERS, { status: 500, requestJson: { name: "Ada" } }));
      a.api.set("/api/orders", []);
    });
    expect(failed.r.error?.code).toBe("health_check_failed"); // handled by the health check, not read-back
  });
});

describe("promotion keeps read-back evidence", () => {
  it("turns a confirmed read-back into an assertion in the proposal and the generated test", async () => {
    const { proposalFromSession, promote } = await import("../src/promote.js");
    const a = new FakeAdapter();
    a.texts.set(key(status), "Saved");
    a.queue(btn, () => {
      a.net.push(write("POST", ORDERS, { json: { id: 7 }, requestJson: { name: "Ada", qty: 3 } }));
      a.api.set("/api/orders", [{ id: 7, name: "Ada", qty: 3 }]);
    });
    const s = await Session.create(a, {});
    await s.step({
      id: "save",
      intent: "save",
      op: "click",
      target: btn,
      mutating: true,
      timeoutMs: 100,
      postconditions: [{ type: "text", target: status, contains: "Saved" }],
    });
    const proposal = proposalFromSession(s, { title: "t", goal: "g" });
    const step = proposal.steps.find((x) => x.id === "save")!;
    expect(step.postconditions?.some((v) => v.type === "api")).toBe(true);
    expect(proposal.assumptions.join(" ")).toContain("added a read-back assertion");
    const code = promote(proposal);
    expect(code).toContain("/api/orders");
    expect(code).toContain("expect.poll");
  });
});
