import { describe, expect, it } from "vitest";
import { AdapterError } from "../src/adapter.js";
import { explore } from "../src/explorer.js";
import type { Actor, ActorDecision } from "../src/explorer.js";
import { pageView, renderFeedback } from "../src/feedback.js";
import { closestControls, postconditionHint, preflightHint } from "../src/hints.js";
import { RepeatGuard, effectPossible } from "../src/repeatGuard.js";
import { Session } from "../src/session.js";
import type { ActionSpec } from "../src/types.js";
import { FakeAdapter, key } from "./fakeAdapter.js";

const save = { role: "button", name: "Save" } as const;
const dropdown = { role: "combobox", name: "Product" } as const;
const status = { role: "status" } as const;

/** Plays a fixed list of decisions and records the feedback it was shown before each one. */
class ScriptActor implements Actor {
  readonly name = "script";
  seen: string[] = [];
  private i = 0;
  constructor(private readonly plan: ActorDecision[]) {}
  async decide(input: { feedback: string }): Promise<ActorDecision> {
    this.seen.push(input.feedback);
    return this.plan[this.i++] ?? { kind: "done", summary: "script ended" };
  }
}

const act = (spec: Partial<ActionSpec> & Pick<ActionSpec, "id" | "op">): ActorDecision => ({
  kind: "act",
  spec: { intent: spec.id, timeoutMs: 100, ...spec },
});

async function setup() {
  const a = new FakeAdapter();
  a.outline = '- button "Save" [ref=e1]\n- combobox "Product" [ref=e2]\n- status [ref=e3]';
  const s = await Session.create(a, {});
  return { a, s };
}

describe("explore - recoverable loop", () => {
  it("shows a failed step to the actor, lets it try something else, and keeps the failure", async () => {
    const { a, s } = await setup();
    a.queue(dropdown, new AdapterError("invalid_action", "Element is not an <input>"));
    const actor = new ScriptActor([
      act({ id: "bad", op: "fill", target: dropdown, value: "x" }),
      act({ id: "good", op: "click", target: save }),
      { kind: "done", summary: "finished" },
    ]);
    const res = await explore(s, actor, { goal: "g", startUrl: "http://app.test/", maxSteps: 6 });
    expect(res.stoppedBecause).toBe("actor_done");
    expect(res.failedSteps).toBe(1);
    expect(s.results.map((r) => [r.actionId, r.status])).toEqual([
      ["open", "verified"],
      ["bad", "failed"],
      ["good", "unverified"],
    ]);
    // The actor saw the failure and the hint before its next decision.
    expect(actor.seen[1]).toContain("result: failed (invalid_action)");
    expect(actor.seen[1]).toContain('use "select"');
    // The failed step stays in the report and out of the promoted test.
    expect(s.report().verdict).toBe("failed");
    expect(res.proposal.steps.map((x) => x.id)).not.toContain("bad");
  });

  it("stops after the consecutive-failure limit", async () => {
    const { a, s } = await setup();
    a.queue(save, new AdapterError("not_found", "no such element"));
    const actor = new ScriptActor(
      Array.from({ length: 6 }, (_, i) => act({ id: `try${i}`, op: "click", target: save })),
    );
    const res = await explore(s, actor, { goal: "g", startUrl: "http://app.test/", maxSteps: 10 });
    expect(res.stoppedBecause).toBe("step_failed");
    expect(res.failedSteps).toBe(3);
  });

  it("gives the actor one final report turn after the failure limit", async () => {
    const { a, s } = await setup();
    a.queue(save, new AdapterError("not_found", "no such element"));
    const finals: boolean[] = [];
    class Reporter extends ScriptActor {
      override async decide(input: { feedback: string; final?: boolean }): Promise<ActorDecision> {
        finals.push(!!input.final);
        if (input.final)
          return { kind: "done", summary: "could not place it; the button is missing" };
        return act({ id: `t${finals.length}`, op: "click", target: save });
      }
    }
    const res = await explore(s, new Reporter([]), { goal: "g", startUrl: "http://app.test/" });
    expect(res.stoppedBecause).toBe("step_failed");
    expect(res.finalReport).toContain("button is missing");
    expect(finals.filter(Boolean)).toHaveLength(1);
    expect(finals.at(-1)).toBe(true);
  });

  it("onStepFailure: stop keeps the old first-failure behaviour", async () => {
    const { a, s } = await setup();
    a.queue(save, new AdapterError("not_found", "no such element"));
    const actor = new ScriptActor([
      act({ id: "a", op: "click", target: save }),
      act({ id: "b", op: "click", target: dropdown }),
    ]);
    const res = await explore(s, actor, {
      goal: "g",
      startUrl: "http://app.test/",
      onStepFailure: "stop",
    });
    expect(res.stoppedBecause).toBe("step_failed");
    expect(s.results).toHaveLength(2); // open + a
  });

  it("lets the actor keep working after an unknown outcome but refuses to repeat the action", async () => {
    const { a, s } = await setup();
    const timeout = new AdapterError("timeout", "Timeout 100ms; performing click action", true);
    a.queue(save, timeout);
    const submit = act({ id: "submit", op: "click", target: save, mutating: true });
    const actor = new ScriptActor([
      submit,
      act({ id: "again", op: "click", target: save, mutating: true }),
      { kind: "done", summary: "stopped" },
    ]);
    const res = await explore(s, actor, { goal: "g", startUrl: "http://app.test/" });
    expect(res.stoppedBecause).toBe("actor_done");
    expect(s.results.map((r) => r.status)).toEqual(["verified", "outcome_unknown", "blocked"]);
    expect(s.results[2]?.error?.code).toBe("repeat_refused");
    expect(a.performed.filter((p) => p.op === "click")).toHaveLength(1);
    // The actor was told not to repeat and how to confirm.
    expect(actor.seen[1]).toContain("do not repeat");
    expect(actor.seen[2]).toContain("refused");
  });

  it("an independent check can confirm an unknown outcome, which clears the run verdict", async () => {
    const { a, s } = await setup();
    a.queue(save, new AdapterError("timeout", "Timeout; performing click action", true));
    a.texts.set(key(status), "Saved");
    const actor = new ScriptActor([
      act({ id: "submit", op: "click", target: save, mutating: true }),
      act({
        id: "check",
        op: "wait",
        confirms: "submit",
        postconditions: [{ type: "text", target: status, contains: "Saved" }],
      }),
      { kind: "done", summary: "ok" },
    ]);
    await explore(s, actor, { goal: "g", startUrl: "http://app.test/" });
    const submit = s.results.find((r) => r.actionId === "submit")!;
    expect(submit.status).toBe("outcome_unknown");
    expect(submit.confirmedBy).toBe("check");
    expect(s.report().verdict).toBe("passed_with_recovery");
  });

  it("a confirming step without a declared check does not confirm anything", async () => {
    const { a, s } = await setup();
    a.queue(save, new AdapterError("timeout", "Timeout; performing click action", true));
    await s.step({ id: "submit", intent: "s", op: "click", target: save, mutating: true });
    await s.step({ id: "check", intent: "c", op: "wait", confirms: "submit" });
    expect(s.results[0]?.confirmedBy).toBeUndefined();
    expect(s.report().verdict).toBe("outcome_unknown");
  });

  it("does continue after a mutating step that provably never reached the page", async () => {
    const { a, s } = await setup();
    a.queue(save, new AdapterError("not_found", "no such element"), undefined);
    a.texts.set(key(status), "Saved");
    const actor = new ScriptActor([
      act({
        id: "submit",
        op: "click",
        target: save,
        mutating: true,
        altTargets: [],
        postconditions: [{ type: "text", target: status, contains: "Saved" }],
      }),
      act({
        id: "submit2",
        op: "click",
        target: save,
        mutating: true,
        postconditions: [{ type: "text", target: status, contains: "Saved" }],
      }),
      { kind: "done", summary: "ok" },
    ]);
    const res = await explore(s, actor, { goal: "g", startUrl: "http://app.test/" });
    expect(res.stoppedBecause).toBe("actor_done");
    expect(s.results.map((r) => r.status)).toEqual(["verified", "failed", "verified"]);
  });

  it("effectPossible encodes which failures could have had an effect", () => {
    const spec = (mutating: boolean) =>
      ({ id: "s", intent: "s", op: "click", mutating }) as ActionSpec;
    const res = (status: string, code?: string) =>
      ({ status, error: code ? { code, message: "m" } : undefined }) as never;
    expect(effectPossible(spec(false), res("failed", "timeout"))).toBe(false);
    expect(effectPossible(spec(true), res("failed", "timeout"))).toBe(true);
    expect(effectPossible(spec(true), res("failed", "invalid_action"))).toBe(false);
    expect(effectPossible(spec(true), res("verified"))).toBe(false);
    expect(effectPossible(spec(true), res("outcome_unknown", "other"))).toBe(true);
  });

  it("RepeatGuard matches on the same action or the same stated intent, and can resolve", () => {
    const g = new RepeatGuard();
    const spec = (id: string, intent: string, name: string) =>
      ({ id, intent, op: "click", mutating: true, target: { role: "button", name } }) as ActionSpec;
    const unknown = { actionId: "s1", status: "outcome_unknown" } as never;
    g.record(spec("s1", "Place the order", "Place order"), unknown);
    expect(g.refuses(spec("s2", "other words", "Place order"))).toContain("refused");
    expect(g.refuses(spec("s3", "place  the ORDER", "Different"))).toContain("refused");
    expect(g.refuses(spec("s4", "cancel", "Cancel"))).toBeUndefined();
    g.resolve("s1");
    expect(g.refuses(spec("s5", "Place the order", "Place order"))).toBeUndefined();
  });
});

describe("enabling steps", () => {
  it("an unchecked enabling step does not downgrade the run once a later step verifies", async () => {
    const { a, s } = await setup();
    a.texts.set(key(status), "Done");
    await s.step({ id: "h", intent: "hover", op: "hover", target: save, timeoutMs: 100 });
    expect(s.report().verdict).toBe("unverified"); // nothing later vouches for it yet
    await s.step({
      id: "c",
      intent: "click",
      op: "click",
      target: save,
      timeoutMs: 100,
      postconditions: [{ type: "text", target: status, contains: "Done" }],
    });
    expect(s.report().verdict).toBe("passed");
    expect(s.results[0]?.status).toBe("unverified"); // still listed as unverified
    expect(s.results[0]?.enabling).toBe(true);
  });

  it("a normal click with no check still makes the run unverified", async () => {
    const { a, s } = await setup();
    a.texts.set(key(status), "Done");
    await s.step({ id: "c1", intent: "click", op: "click", target: save, timeoutMs: 100 });
    await s.step({
      id: "c2",
      intent: "verify",
      op: "click",
      target: save,
      timeoutMs: 100,
      postconditions: [{ type: "text", target: status, contains: "Done" }],
    });
    expect(s.report().verdict).toBe("unverified");
  });
});

describe("hints", () => {
  it("rejects a clearly wrong op before anything is sent to the page", async () => {
    const { a, s } = await setup();
    const r = await s.step({
      id: "f",
      intent: "f",
      op: "fill",
      target: save,
      value: "x",
      timeoutMs: 100,
    });
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("invalid_action");
    expect(r.error?.hint).toContain('use op "click"');
    expect(a.performed).toHaveLength(0);
  });

  it("does not pre-reject fill on a combobox (it may be an editable input)", () => {
    expect(preflightHint({ id: "x", intent: "x", op: "fill", target: dropdown, value: "v" })).toBe(
      undefined,
    );
    expect(
      preflightHint({ id: "x", intent: "x", op: "select", target: dropdown, value: "v" }),
    ).toBe(undefined);
    expect(preflightHint({ id: "x", intent: "x", op: "check", target: save })).toContain("click");
  });

  it("adds nearby control names to a not_found failure", async () => {
    const { a, s } = await setup();
    a.queue({ role: "button", name: "Sav" }, new AdapterError("not_found", "waiting for locator"));
    const r = await s.step({
      id: "c",
      intent: "c",
      op: "click",
      target: { role: "button", name: "Sav" },
      timeoutMs: 100,
    });
    expect(r.status).toBe("failed");
    expect(r.error?.hint).toContain('button "Save"');
  });

  it("explains that text checks do not read what was typed into a field", () => {
    const spec = { id: "f", intent: "f", op: "fill", value: "Ada", target: save } as ActionSpec;
    const verdict = {
      verifier: { type: "text", contains: "Ada" },
      status: "fail",
      detail: "x",
    } as never;
    expect(postconditionHint(spec, verdict)).toContain("not what was typed");
  });

  it("closestControls ranks by shared words and falls back to the first controls", () => {
    const cs = [
      { ref: "a", role: "button", name: "Cancel order" },
      { ref: "b", role: "button", name: "Place order" },
    ];
    expect(closestControls("Place the order", cs)[0]?.name).toBe("Place order");
    expect(closestControls("zzz", cs)).toHaveLength(2);
  });
});

describe("feedback rendering", () => {
  it("includes failed checks, hints and recoveries, and shows the outline when complete", async () => {
    const { a, s } = await setup();
    a.queue(save, new AdapterError("not_found", "x"), undefined);
    const r = await s.step({
      id: "c",
      intent: "c",
      op: "click",
      target: save,
      altTargets: [{ testId: "save" }],
      timeoutMs: 100,
    });
    const obs = await s.observe();
    const text = renderFeedback(r, obs);
    expect(text).toContain("recovery alt_target succeeded");
    expect(text).toContain('- button "Save"');
  });

  it("switches to the controls list when the outline was truncated", async () => {
    const { a, s } = await setup();
    a.outline = Array.from({ length: 400 }, (_, i) => `- button "Row ${i}" [ref=e${i}]`).join("\n");
    const obs = await s.observe({ level: "outline" });
    expect(obs.truncated).toBe(true);
    const view = pageView(obs);
    expect(view).toContain("showing interactive controls only");
    expect(view.length).toBeLessThan(6200);
  });
});
