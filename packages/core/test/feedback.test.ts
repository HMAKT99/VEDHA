import { describe, expect, it } from "vitest";
import { describeResult } from "../src/feedback.js";
import type { ActionResult } from "../src/types.js";

const result = (extra: Partial<ActionResult>): ActionResult =>
  ({
    schema: "vedha/action-result/v1",
    actionId: "s",
    status: "unverified",
    recovered: false,
    verdicts: [],
    recoveries: [],
    attempts: 1,
    durationMs: 1,
    ...extra,
  }) as ActionResult;

describe("evidence-first result lines", () => {
  it("never tells the model the effect is unchecked", () => {
    const text = describeResult(result({})).join("\n");
    expect(text).not.toContain("unchecked");
    expect(text).not.toContain("unverified");
    expect(text).toContain("result: done (no expectation declared)");
  });

  it("says confirmed when a read-back confirmed the write", () => {
    const lines = describeResult(
      result({
        requests: ["POST /api/event 200"],
        readback: ["read-back /api/events confirms POST /api/event"],
      }),
    );
    expect(lines).toContain("effect: confirmed (read-back /api/events confirms POST /api/event)");
  });

  it("says the server confirmed a passed step that sent a write, and nothing for one that sent none", () => {
    const sent = describeResult(
      result({ status: "verified", requests: ["POST /api/event 200"] }),
    ).join("\n");
    expect(sent).toContain("effect: server confirmed (POST /api/event 200)");
    const quiet = describeResult(result({ status: "verified", requests: ["GET /api/x 200"] }));
    expect(quiet.join("\n")).not.toContain("server confirmed");
  });

  it("lists what was observed, or says nothing was", () => {
    expect(describeResult(result({ requests: ["POST /api/x 200"] })).join("\n")).toContain(
      "effect: observed (requests POST /api/x 200)",
    );
    expect(describeResult(result({}), true).join("\n")).toContain("the page changed");
    expect(describeResult(result({})).join("\n")).toContain("effect: none observed");
  });

  it("stays silent about the effect of enabling steps and keeps failed results unchanged", () => {
    expect(describeResult(result({ enabling: true })).join("\n")).not.toContain("effect:");
    const failed = describeResult(result({ status: "failed" })).join("\n");
    expect(failed).toContain("result: failed");
    expect(failed).not.toContain("effect:");
  });
});
