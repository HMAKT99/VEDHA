import { describe, expect, it } from "vitest";
import { toTarget } from "../src/tools.js";

describe("toTarget", () => {
  it("resolves several selectors by stability instead of failing", () => {
    expect(toTarget({ role: "checkbox", name: "News", ref: "e4" })).toEqual({
      role: "checkbox",
      name: "News",
      exact: true,
    });
    expect(toTarget({ ref: "e4" })).toEqual({ ref: "e4" });
    expect(toTarget({ role: "button", name: "Go", label: "Go" })).toEqual({
      role: "button",
      name: "Go",
      exact: true,
    });
    expect(toTarget({ label: "Plan", text: "Plan" })).toEqual({ label: "Plan", exact: true });
  });

  it("keeps the iframe and still rejects an empty target", () => {
    expect(toTarget({ test_id: "pay", frame: "iframe#p" })).toEqual({
      inFrame: "iframe#p",
      target: { testId: "pay" },
    });
    expect(() => toTarget({})).toThrow(/needs one of/);
  });
});
