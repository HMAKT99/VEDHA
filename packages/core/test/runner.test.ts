import { describe, expect, it } from "vitest";
import { AdapterError } from "../src/adapter.js";
import { Session } from "../src/session.js";
import type { ActionSpec } from "../src/types.js";
import { FakeAdapter, key } from "./fakeAdapter.js";

const btn = { role: "button", name: "Save" } as const;
const status = { role: "status" } as const;

async function sess(a: FakeAdapter, policy = {}) {
  return Session.create(a, policy);
}

const click = (extra: Partial<ActionSpec> = {}): ActionSpec => ({
  id: "s",
  intent: "save",
  op: "click",
  target: btn,
  timeoutMs: 100,
  ...extra,
});

describe("executeAction - verification", () => {
  it("is verified only when every postcondition passes", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "Saved!");
    const s = await sess(a);
    const r = await s.step(
      click({ postconditions: [{ type: "text", target: status, contains: "Saved" }] }),
    );
    expect(r.status).toBe("verified");
    expect(r.verdicts[0]?.status).toBe("pass");
  });

  it("never reports verified when no postcondition is declared", async () => {
    const s = await sess(new FakeAdapter());
    const r = await s.step(click());
    expect(r.status).toBe("unverified");
    expect(s.report().verdict).toBe("unverified");
  });

  it("fails when a postcondition fails even though the action returned", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "Error");
    const s = await sess(a);
    const r = await s.step(
      click({ postconditions: [{ type: "text", target: status, contains: "Saved" }] }),
    );
    expect(r.status).toBe("failed");
    expect(r.error?.message).toContain("postcondition failed");
  });

  it("verifies network status and json fields", async () => {
    const a = new FakeAdapter();
    const s = await sess(a);
    a.queue(btn, () =>
      a.net.push({
        method: "POST",
        url: "http://app.test/api/orders",
        status: 201,
        json: { qty: 3 },
      }),
    );
    const ok = await s.step(
      click({
        postconditions: [
          {
            type: "network",
            method: "POST",
            urlPattern: "/api/orders",
            status: "2xx",
            json: { path: "qty", equals: 3 },
          },
        ],
      }),
    );
    expect(ok.status).toBe("verified");
    a.queue(btn, () =>
      a.net.push({
        method: "POST",
        url: "http://app.test/api/orders",
        status: 201,
        json: { qty: 4 },
      }),
    );
    const bad = await s.step(
      click({
        id: "s2",
        postconditions: [
          {
            type: "network",
            method: "POST",
            urlPattern: "/api/orders",
            status: "2xx",
            json: { path: "qty", equals: 3 },
          },
        ],
      }),
    );
    expect(bad.status).toBe("failed");
    expect(bad.verdicts[0]?.definitive).toBe(true);
  });
});

describe("executeAction - bounded recovery preserves the original failure", () => {
  it("records an alt_target recovery with the original error and marks the step recovered", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "ok");
    a.queue(btn, new AdapterError("not_found", "no such button"));
    const s = await sess(a);
    const alt = { testId: "save" };
    const r = await s.step(
      click({
        altTargets: [alt],
        postconditions: [{ type: "text", target: status, contains: "ok" }],
      }),
    );
    expect(r.status).toBe("verified");
    expect(r.recovered).toBe(true);
    expect(r.recoveries).toHaveLength(1);
    expect(r.recoveries[0]).toMatchObject({
      strategy: "alt_target",
      outcome: "succeeded",
      originalError: { code: "not_found" },
    });
    expect(r.usedTarget).toEqual(alt);
    expect(s.report().verdict).toBe("passed_with_recovery");
  });

  it("dismisses a known interstitial, retries, and records it", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "ok");
    a.queue(
      btn,
      new AdapterError("blocked_by_overlay", "div intercepts pointer events"),
      undefined,
    );
    const s = await sess(a);
    const accept = { role: "button", name: "Accept" } as const;
    const r = await s.step(
      click({
        dismiss: [accept],
        postconditions: [{ type: "text", target: status, contains: "ok" }],
      }),
    );
    expect(r.status).toBe("verified");
    expect(r.recoveries[0]?.strategy).toBe("dismiss_interstitial");
    expect(a.performed.some((p) => key(p.target) === key(accept))).toBe(true);
  });

  it("composes: alternate target found but blocked, then dismiss, then success on the alternate", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "ok");
    const alt = { testId: "save" };
    a.queue(btn, new AdapterError("not_found", "missing"));
    a.queue(alt, new AdapterError("blocked_by_overlay", "blocked"), undefined);
    const s = await sess(a);
    const r = await s.step(
      click({
        altTargets: [alt],
        dismiss: [{ role: "button", name: "Accept" }],
        postconditions: [{ type: "text", target: status, contains: "ok" }],
      }),
    );
    expect(r.status).toBe("verified");
    expect(r.recoveries.map((x) => x.strategy)).toEqual(["alt_target", "dismiss_interstitial"]);
    expect(r.usedTarget).toEqual(alt);
  });

  it("does not mask a real defect: all recovery fails and the original error is reported", async () => {
    const a = new FakeAdapter();
    const err = new AdapterError("not_actionable", "element is not enabled");
    a.queue(btn, err);
    a.queue({ testId: "save" }, err);
    const s = await sess(a);
    const r = await s.step(click({ altTargets: [{ testId: "save" }] }));
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("not_actionable");
    expect(r.recoveries.every((x) => x.outcome === "failed")).toBe(true);
    expect(r.recovered).toBe(false);
  });

  it("is bounded: never exceeds maxAttempts + alternates", async () => {
    const a = new FakeAdapter();
    a.queue(btn, new AdapterError("timeout", "t"));
    a.queue({ testId: "a" }, new AdapterError("timeout", "t"));
    a.queue({ testId: "b" }, new AdapterError("timeout", "t"));
    const s = await sess(a);
    const r = await s.step({
      id: "x",
      intent: "read",
      op: "click",
      target: btn,
      timeoutMs: 50,
      altTargets: [{ testId: "a" }, { testId: "b" }],
    });
    expect(r.status).toBe("failed");
    expect(a.performed.length).toBeLessThanOrEqual(3 + 2);
  });
});

describe("mutating actions: outcome_unknown and reconcile", () => {
  const mut = (extra: Partial<ActionSpec> = {}): ActionSpec =>
    click({
      mutating: true,
      postconditions: [{ type: "text", target: status, contains: "placed" }],
      ...extra,
    });

  it("returns outcome_unknown and does not re-issue when the outcome is unobserved and no reconcile exists", async () => {
    const a = new FakeAdapter(); // status text never appears
    const s = await sess(a);
    const r = await s.step(mut());
    expect(r.status).toBe("outcome_unknown");
    expect(a.performed.filter((p) => p.op === "click")).toHaveLength(1);
    expect(s.report().verdict).toBe("outcome_unknown");
  });

  it("confirms via reconcile without re-issuing when the effect already happened", async () => {
    const a = new FakeAdapter();
    a.api.set("/api/orders", [{ name: "Ada", qty: 3 }]);
    const s = await sess(a);
    const r = await s.step(
      mut({ reconcile: { type: "api", get: "/api/orders", matchesAny: { name: "Ada" } } }),
    );
    expect(r.status).toBe("verified");
    expect(r.note).toContain("reconcile");
    expect(a.performed.filter((p) => p.op === "click")).toHaveLength(1);
    expect(r.verdicts.some((v) => v.status === "unverifiable")).toBe(true);
  });

  it("re-issues exactly once when reconcile proves the effect is absent", async () => {
    const a = new FakeAdapter();
    a.queue(btn, undefined, () => a.texts.set(key(status), "placed"));
    const s = await sess(a);
    const r = await s.step(
      mut({ reconcile: { type: "api", get: "/api/orders", matchesAny: { name: "Ada" } } }),
    );
    expect(r.status).toBe("verified");
    expect(r.recovered).toBe(true);
    expect(a.performed.filter((p) => p.op === "click")).toHaveLength(2);
    expect(r.recoveries[0]?.strategy).toBe("retry_transient");
  });

  it("does not re-issue after the server accepted (2xx) but the response contradicted the postcondition", async () => {
    const a = new FakeAdapter();
    a.queue(btn, () =>
      a.net.push({
        method: "POST",
        url: "http://app.test/api/orders",
        status: 201,
        json: { qty: 4 },
      }),
    );
    const s = await sess(a);
    const r = await s.step(
      click({
        mutating: true,
        postconditions: [
          {
            type: "network",
            method: "POST",
            urlPattern: "/api/orders",
            status: "2xx",
            json: { path: "qty", equals: 3 },
          },
        ],
        reconcile: { type: "api", get: "/api/orders", matchesAny: { qty: 3 } },
      }),
    );
    expect(r.status).toBe("failed");
    expect(a.performed.filter((p) => p.op === "click")).toHaveLength(1);
  });

  it("treats a dispatched-then-failed mutating action as uncertain, not retryable", async () => {
    const a = new FakeAdapter();
    a.queue(btn, new AdapterError("timeout", "Timeout; performing click action", true));
    const s = await sess(a);
    const r = await s.step(mut());
    expect(r.status).toBe("outcome_unknown");
    expect(a.performed.filter((p) => p.op === "click")).toHaveLength(1);
  });
});

describe("policy gates and budgets", () => {
  it("blocks destructive actions without approval and allows them with it", async () => {
    const a = new FakeAdapter();
    const s = await sess(a, { destructiveRequiresApproval: true });
    const r = await s.step(click({ destructive: true }));
    expect(r.status).toBe("blocked");
    expect(a.performed).toHaveLength(0);
    const s2 = await sess(new FakeAdapter(), {
      destructiveRequiresApproval: true,
      approveDestructive: true,
    });
    expect((await s2.step(click({ destructive: true }))).status).toBe("unverified");
  });

  it("blocks goto outside allowedDomains before touching the browser", async () => {
    const a = new FakeAdapter();
    const s = await sess(a, { allowedDomains: ["app.test"] });
    const r = await s.step({ id: "g", intent: "go", op: "goto", value: "https://evil.example/" });
    expect(r.status).toBe("blocked");
    expect(a.performed).toHaveLength(0);
  });

  it("enforces maxSteps", async () => {
    const s = await sess(new FakeAdapter(), { maxSteps: 1 });
    expect((await s.step(click({ id: "1" }))).status).toBe("unverified");
    expect((await s.step(click({ id: "2" }))).status).toBe("blocked");
  });

  it("redacts configured secrets and token-like strings from traces", async () => {
    const s = await sess(new FakeAdapter(), { secrets: ["hunter2-secret"] });
    await s.step(
      click({ intent: "login with hunter2-secret and Bearer abcdefghijklmnopqrstuvwxyz0123" }),
    );
    const text = JSON.stringify(s.trace.events);
    expect(text).not.toContain("hunter2-secret");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(text).toContain("[REDACTED]");
  });
});

describe("implicit read-back verification", () => {
  const field = { label: "Password", exact: true } as const;
  const fill = (extra: Partial<ActionSpec> = {}): ActionSpec => ({
    id: "f",
    intent: "enter password",
    op: "fill",
    target: field,
    value: "hunter2-secret",
    timeoutMs: 100,
    ...extra,
  });

  it("verifies a fill by reading the value back, without echoing it", async () => {
    const a = new FakeAdapter();
    a.values.set(key(field), "hunter2-secret");
    const s = await sess(a);
    const r = await s.step(fill());
    expect(r.status).toBe("verified");
    expect(r.verdicts[0]?.implicit).toBe(true);
    expect(JSON.stringify(r)).not.toContain("hunter2-secret");
  });

  it("fails when the field does not hold the typed value", async () => {
    const a = new FakeAdapter();
    a.values.set(key(field), "something-else");
    const s = await sess(a);
    const r = await s.step(fill());
    expect(r.status).toBe("failed");
    expect(JSON.stringify(r)).not.toContain("something-else");
  });

  it("does not invent postconditions for click and keeps declared ones authoritative", async () => {
    const s = await sess(new FakeAdapter());
    expect((await s.step(click())).status).toBe("unverified");
    const a = new FakeAdapter();
    a.values.set(key(field), "hunter2-secret");
    const s2 = await sess(a);
    const r = await s2.step(fill({ postconditions: [{ type: "url", matches: "nowhere" }] }));
    expect(r.status).toBe("failed"); // declared url check applies; implicit check is not added on top
  });
});

describe("api postcondition", () => {
  it("is a definitive failure when the probe answers but the effect is absent", async () => {
    const a = new FakeAdapter();
    a.api.set("/api/events", [{ type: "other" }]);
    a.texts.set(key(status), "Saved");
    const s = await sess(a);
    const r = await s.step(
      click({
        mutating: true,
        postconditions: [
          { type: "text", target: status, contains: "Saved" },
          { type: "api", get: "/api/events", matchesAny: { type: "saved" } },
        ],
      }),
    );
    // UI says saved, the server state says no: failed, not outcome_unknown.
    expect(r.status).toBe("failed");
    expect(r.verdicts.find((v) => v.verifier.type === "api")?.definitive).toBe(true);
  });
});

describe("synchronous steps", () => {
  const spec = (synchronous: boolean) =>
    click({
      mutating: true,
      synchronous,
      postconditions: [{ type: "text", target: status, contains: "Done" }],
    });

  it("fail (not outcome_unknown) when the declared check does not hold", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "Not yet");
    const s = await sess(a);
    const r = await s.step(spec(true));
    expect(r.status).toBe("failed");
    expect(r.note).toContain("synchronous");
  });

  it("default to outcome_unknown for the same unmet check", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "Not yet");
    const s = await sess(a);
    expect((await s.step(spec(false))).status).toBe("outcome_unknown");
  });
});

describe("idle-aware classification", () => {
  const unmet = (extra: Partial<ActionSpec> = {}): ActionSpec =>
    click({
      mutating: true,
      postconditions: [{ type: "text", target: status, contains: "Done" }],
      ...extra,
    });

  it("an unmet check on an idle page is a failure, not an unknown outcome", async () => {
    const a = new FakeAdapter();
    a.pending = 0;
    a.texts.set(key(status), "Not yet");
    const s = await sess(a);
    const r = await s.step(unmet());
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("expectation_not_met");
    expect(r.error?.hint).toContain("confirms");
  });

  it("stays outcome_unknown while a request is still in flight", async () => {
    const a = new FakeAdapter();
    a.pending = 1;
    a.texts.set(key(status), "Not yet");
    const s = await sess(a);
    expect((await s.step(unmet())).status).toBe("outcome_unknown");
  });

  it("stays outcome_unknown when the adapter cannot report in-flight requests", async () => {
    const a = new FakeAdapter();
    a.texts.set(key(status), "Not yet");
    const s = await sess(a);
    expect((await s.step(unmet())).status).toBe("outcome_unknown");
  });

  it("a later independent check clears it, and the repeat is still refused until then", async () => {
    const a = new FakeAdapter();
    a.pending = 0;
    a.texts.set(key(status), "Not yet");
    const s = await sess(a);
    await s.step(unmet({ id: "go" }));
    expect(s.report().verdict).toBe("failed");
    a.texts.set(key(status), "Actually saved");
    await s.step({
      id: "check",
      intent: "confirm",
      op: "wait",
      confirms: "go",
      timeoutMs: 100,
      postconditions: [{ type: "text", target: status, contains: "saved" }],
    });
    expect(s.results[0]?.confirmedBy).toBe("check");
    expect(s.report().verdict).toBe("passed_with_recovery");
  });

  it("a health-check failure is never clearable by confirms", async () => {
    const a = new FakeAdapter();
    a.pending = 0;
    a.texts.set(key(status), "Done");
    a.queue(btn, () => a.net.push({ method: "POST", url: "http://app.test/api/x", status: 500 }));
    const s = await sess(a);
    await s.step(unmet({ id: "go" }));
    expect(s.results[0]?.error?.code).toBe("health_check_failed");
    await s.step({
      id: "check",
      intent: "confirm",
      op: "wait",
      confirms: "go",
      timeoutMs: 100,
      postconditions: [{ type: "text", target: status, contains: "Done" }],
    });
    expect(s.results[0]?.confirmedBy).toBeUndefined();
    expect(s.report().verdict).toBe("failed");
  });
});
