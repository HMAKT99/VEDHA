import { describe, expect, it } from "vitest";
import { jsonSchemas, parseSpecFile } from "../src/schema.js";

const ok = {
  steps: [{ id: "a", intent: "i", op: "click", target: { role: "button", name: "Go" } }],
};

describe("spec validation (untrusted input)", () => {
  it("accepts a minimal valid spec and nested targets/verifiers", () => {
    expect(parseSpecFile(ok).steps).toHaveLength(1);
    const nested = {
      steps: [
        {
          id: "a",
          intent: "i",
          op: "click",
          target: {
            within: { role: "row", name: "Bob" },
            target: { role: "button", name: "Delete" },
          },
          postconditions: [
            { type: "network", urlPattern: "/x", status: "2xx", json: { path: "a.b", equals: 3 } },
          ],
        },
      ],
    };
    expect(parseSpecFile(nested)).toBeTruthy();
  });
  it("rejects unknown keys, missing targets and bad ops", () => {
    expect(() => parseSpecFile({ steps: [{ ...ok.steps[0], extra: 1 }] })).toThrow(/invalid spec/);
    expect(() => parseSpecFile({ steps: [{ id: "a", intent: "i", op: "click" }] })).toThrow(
      /requires a target/,
    );
    expect(() =>
      parseSpecFile({ steps: [{ id: "a", intent: "i", op: "eval", target: { role: "x" } }] }),
    ).toThrow(/invalid spec/);
    expect(() => parseSpecFile({ steps: [] })).toThrow(/invalid spec/);
    expect(() => parseSpecFile({ steps: [{ id: "a", intent: "i", op: "goto" }] })).toThrow(
      /goto requires/,
    );
  });
  it("rejects absurd timeouts and api probes outside the origin", () => {
    expect(() => parseSpecFile({ steps: [{ ...ok.steps[0], timeoutMs: 10_000_000 }] })).toThrow();
    expect(() =>
      parseSpecFile({
        steps: [
          { ...ok.steps[0], reconcile: { type: "api", get: "http://evil/", matchesAny: {} } },
        ],
      }),
    ).toThrow();
  });
  it("emits versioned JSON Schemas", () => {
    const s = jsonSchemas();
    expect(Object.keys(s)).toContain("vedha.action-spec/v1");
    expect(JSON.stringify(s)).toContain("postconditions");
  });
});
