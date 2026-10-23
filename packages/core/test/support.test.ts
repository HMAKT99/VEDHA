import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBundle, readBundle, replayBundle, writeBundle } from "../src/bundle.js";
import { observe, parseOutline } from "../src/observation.js";
import { hostAllowed, redact, resolveInside, urlAllowed } from "../src/policy.js";
import { promote, proposalFromSession } from "../src/promote.js";
import { Session } from "../src/session.js";
import { jsonPath, matchesFields, pollStable } from "../src/verifiers.js";
import { AdapterError } from "../src/adapter.js";
import { FakeAdapter, key } from "./fakeAdapter.js";

describe("policy utilities", () => {
  it("matches allowed domains exactly or as parents, not as suffix strings", () => {
    expect(hostAllowed("app.example.com", ["example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["example.com"])).toBe(true);
    expect(hostAllowed("evilexample.com", ["example.com"])).toBe(false);
    expect(hostAllowed("anything", undefined)).toBe(true);
  });
  it("rejects dangerous schemes and unparsable urls", () => {
    expect(urlAllowed("file:///etc/passwd", {}).allowed).toBe(false);
    expect(urlAllowed("javascript:alert(1)", {}).allowed).toBe(false);
    expect(urlAllowed("not a url", {}).allowed).toBe(false);
    expect(urlAllowed("http://a.test/", { allowedDomains: ["a.test"] }).allowed).toBe(true);
    expect(urlAllowed("data:text/html,x", { allowedDomains: ["a.test"] }).allowed).toBe(false);
  });
  it("redacts likely secrets", () => {
    expect(redact("key sk-abcdefghijklmnopqrstuv end")).toContain("[REDACTED]");
    expect(redact("password=hunter22")).toBe("password=[REDACTED]");
    expect(redact("AKIAABCDEFGHIJKLMNOP")).toBe("[REDACTED]");
    expect(redact("nothing here")).toBe("nothing here");
  });
  it("blocks path traversal", () => {
    expect(resolveInside("/tmp/x", "a/b.json")).toBe(path.resolve("/tmp/x/a/b.json"));
    expect(() => resolveInside("/tmp/x", "../etc/passwd")).toThrow(/escapes/);
    expect(() => resolveInside("/tmp/x", "/etc/passwd")).toThrow(/escapes/);
  });
});

describe("verifier helpers", () => {
  it("evaluates json paths and field matches", () => {
    expect(jsonPath({ a: { b: [{ c: 5 }] } }, "a.b[0].c")).toBe(5);
    expect(jsonPath({ a: 1 }, "a.x.y")).toBeUndefined();
    expect(matchesFields({ name: "Ada", qty: 3, z: 1 }, { name: "Ada", qty: 3 })).toBe(true);
    expect(matchesFields({ name: "Ada", qty: 4 }, { name: "Ada", qty: 3 })).toBe(false);
  });
});

describe("observation", () => {
  const outline = [
    '- heading "Shop" [level=1] [ref=e2]',
    '- textbox "Name" [ref=e3]',
    '- button "Place order" [ref=e4]',
  ].join("\n");
  it("parses roles, names and refs", () => {
    expect(parseOutline(outline).map((e) => [e.role, e.name, e.ref])).toEqual([
      ["heading", "Shop", "e2"],
      ["textbox", "Name", "e3"],
      ["button", "Place order", "e4"],
    ]);
  });
  it("is bounded and flagged untrusted", async () => {
    const a = new FakeAdapter();
    a.outline = Array.from({ length: 500 }, (_, i) => `- button "B${i}" [ref=e${i}]`).join("\n");
    const o = await observe(a, { maxChars: 300 });
    expect(o.truncated).toBe(true);
    expect(o.outline.length).toBeLessThanOrEqual(330);
    expect(o.untrusted).toBe(true);
  });
  it("reports only changes as a delta and is smaller than the full outline", async () => {
    const a = new FakeAdapter();
    a.outline = Array.from({ length: 60 }, (_, i) => `- button "B${i}" [ref=e${i}]`).join("\n");
    const first = await observe(a, {});
    a.outline += '\n- status "Done" [ref=e99]';
    const second = await observe(a, { previous: first });
    expect(second.delta?.added).toEqual(['- status "Done" [ref=e99]']);
    expect(second.chars).toBeLessThan(first.chars / 5);
    const third = await observe(a, { previous: second });
    expect(third.delta?.added).toBeDefined();
  });
});

describe("observation levels", () => {
  it("controls level lists interactive elements only and finds controls beyond the outline budget", async () => {
    const a = new FakeAdapter();
    const filler = Array.from(
      { length: 500 },
      (_, i) => `- paragraph [ref=p${i}]: Row ${i} lorem ipsum dolor sit amet`,
    ).join("\n");
    a.outline = `- heading "Shop" [ref=h1]\n${filler}\n- textbox "Name" [ref=e900]\n- button "Place order" [ref=e901]`;
    const controls = await observe(a, { level: "controls", maxChars: 6000 });
    const outline = await observe(a, { level: "outline", maxChars: 6000 });
    expect(controls.controls.map((c) => c.name)).toEqual(["Shop", "Name", "Place order"]);
    expect(controls.chars).toBeLessThan(200);
    expect(outline.truncated).toBe(true);
    expect(outline.text).not.toContain("Place order"); // would be invisible to an actor reading the truncated outline
    expect(controls.text).toContain("Place order");
    expect(controls.chars).toBeLessThan(outline.chars / 20);
  });
});

describe("bundle, replay, promotion", () => {
  async function ranSession() {
    const a = new FakeAdapter();
    a.texts.set(key({ role: "status" }), "Order placed");
    a.queue({ role: "button", name: "Place order" }, new AdapterError("not_found", "renamed"));
    const s = await Session.create(a, { secrets: ["s3cr3t-value"] });
    await s.step({
      id: "open",
      intent: "open",
      op: "goto",
      value: "http://app.test/",
      postconditions: [{ type: "url", matches: "app.test" }],
    });
    await s.step({
      id: "submit",
      intent: "place the order",
      op: "click",
      target: { role: "button", name: "Place order" },
      altTargets: [{ testId: "place-order" }],
      postconditions: [{ type: "text", target: { role: "status" }, contains: "Order placed" }],
    });
    return { a, s };
  }

  it("round-trips a failure bundle and keeps recovery records", async () => {
    const { s } = await ranSession();
    const b = createBundle(s, "place an order");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-bundle-"));
    await writeBundle(dir, b);
    const back = readBundle(dir);
    expect(back.schema).toBe("vedha.failure-bundle/v1");
    expect(back.report.steps[1]?.recoveries[0]?.originalError.code).toBe("not_found");
    expect(back.replay.reasons.join(" ")).toContain("live application");
    expect(fs.existsSync(path.join(dir, "trace.ndjson"))).toBe(true);
  });

  it("rejects bundles with an unknown schema", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-bundle-"));
    fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify({ schema: "other/v9" }));
    expect(() => readBundle(dir)).toThrow(/unsupported bundle schema/);
  });

  it("replays and reports divergences", async () => {
    const { s } = await ranSession();
    const b = createBundle(s, "g");
    const a2 = new FakeAdapter(); // different world: no status text, button exists
    const s2 = await Session.create(a2, {});
    const res = await replayBundle(s2, b);
    expect(res.divergences.length).toBeGreaterThan(0);
  });

  it("promotes verified steps to a Playwright spec using the locator that worked", async () => {
    const { s } = await ranSession();
    const p = proposalFromSession(s, { title: "place order", goal: "place an order" });
    expect(p.assumptions.some((x) => x.includes("only succeeded after recovery"))).toBe(true);
    expect(p.confidence).toBeGreaterThan(0);
    const code = promote(p);
    expect(code).toContain('getByTestId("place-order")');
    expect(code).not.toContain('getByRole("button", { name: "Place order" })');
    expect(code).toContain('toContainText("Order placed")');
    expect(code).toContain("ASSUMPTION");
  });

  it("emits exact label/text matching in promoted tests", () => {
    const p = {
      schema: "vedha.test-proposal/v1" as const,
      title: "t",
      goal: "g",
      preconditions: [],
      assertions: [],
      cleanup: [],
      evidence: [],
      confidence: 1,
      assumptions: [],
      steps: [
        {
          id: "a",
          intent: "i",
          op: "fill" as const,
          target: { label: "Name", exact: true },
          value: "x",
        },
      ],
    };
    expect(promote(p)).toContain('getByLabel("Name", { exact: true })');
  });

  it("refuses to promote ref-based targets", () => {
    const p = {
      schema: "vedha.test-proposal/v1" as const,
      title: "t",
      goal: "g",
      preconditions: [],
      assertions: [],
      cleanup: [],
      evidence: [],
      confidence: 1,
      assumptions: [],
      steps: [{ id: "a", intent: "i", op: "click" as const, target: { ref: "e5" } }],
    };
    expect(() => promote(p)).toThrow(/ref targets/);
  });
});

describe("pollStable", () => {
  it("does not pass on a match that is rendered away", async () => {
    // Matches on the first read only, then the page re-renders it away.
    let reads = 0;
    const r = await pollStable(async () => (++reads === 1 ? true : undefined), 120, 20, 10);
    expect(r).toBeUndefined();
  });

  it("passes on a match that holds", async () => {
    let reads = 0;
    const r = await pollStable(async () => (++reads >= 3 ? true : undefined), 500, 20, 10);
    expect(r).toBe(true);
  });
});
