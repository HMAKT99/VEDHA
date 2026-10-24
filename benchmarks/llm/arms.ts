import type { Browser, Page, Response } from "playwright";
import { PlaywrightAdapter } from "@vedhajs/adapter-playwright";
import { Session, describeResult, explore } from "@vedhajs/core";
import type { Actor, ActorDecision, ActionResult } from "@vedhajs/core";
import { doAction } from "../drivers/common.js";
import type { DriverOutcome } from "../drivers/types.js";
import { LlmAgent, type Decision, type Expect } from "./agent.js";
import type { Gateway } from "./gateway.js";

const MAX_STEPS = 10;
const OBS_CAP = 12_000;

export interface ArmContext {
  browser: Browser;
  gw: Gateway;
  goal: string;
  baseUrl: string;
}

export interface ArmOutcome extends DriverOutcome {
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  transcript: unknown[];
}

const cap = (s: string) => (s.length > OBS_CAP ? s.slice(0, OBS_CAP) + "\n[truncated]" : s);

function tokensOf(gw: Gateway, before: { p: number; c: number; calls: number }) {
  return {
    llmCalls: gw.calls - before.calls,
    promptTokens: gw.promptTokens - before.p,
    completionTokens: gw.completionTokens - before.c,
  };
}

/** Arm A: the model drives plain Playwright; expectations are checked by this harness, nothing else is. */
export async function runPlainArm(ctx: ArmContext): Promise<ArmOutcome> {
  const before = { p: ctx.gw.promptTokens, c: ctx.gw.completionTokens, calls: ctx.gw.calls };
  const page = await (
    await ctx.browser.newContext({ viewport: { width: 1000, height: 800 } })
  ).newPage();
  const agent = new LlmAgent(ctx.gw, ctx.goal);
  let actions = 0;
  let obsChars = 0;
  let claim: DriverOutcome["claim"] = "uncertain";
  let diagnostic = "";
  try {
    await page.goto(ctx.baseUrl);
    let feedback = "";
    const observe = async () => {
      const snap = cap(await page.locator("body").ariaSnapshot({ mode: "ai" }));
      obsChars += snap.length;
      return `url: ${page.url()}\n${snap}`;
    };
    feedback = await observe();
    for (let i = 0; i < MAX_STEPS; i++) {
      const d: Decision = await agent.decide(feedback, ctx.baseUrl);
      if (d.kind === "done") {
        claim = d.success ? "pass" : "fail";
        diagnostic = d.summary.slice(0, 300);
        break;
      }
      if (d.kind === "invalid") {
        feedback = `Invalid response (${d.reason}). Call exactly one tool.`;
        continue;
      }
      actions++;
      const result = await runPlainAction(page, d, ctx.baseUrl);
      feedback = `result: ${result}\n${await observe()}`;
    }
    return {
      claim,
      browserActions: actions,
      observationChars: obsChars,
      recoveries: 0,
      diagnostic,
      ...tokensOf(ctx.gw, before),
      transcript: agent.messages,
    };
  } finally {
    await page.context().close();
  }
}

async function runPlainAction(
  page: Page,
  d: Extract<Decision, { kind: "act" }>,
  baseUrl: string,
): Promise<string> {
  const e: Expect = d.expect;
  let response: Promise<Response> | undefined;
  if (e.request?.url_contains) {
    const want = e.request;
    response = page.waitForResponse(
      (r) =>
        r.url().includes(want.url_contains!) &&
        (!want.method || r.request().method() === want.method.toUpperCase()),
      { timeout: 4000 },
    );
    response.catch(() => undefined);
  }
  try {
    await doAction(page, { ...d.spec, timeoutMs: 5000 }, baseUrl);
  } catch (err) {
    return `action failed: ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`;
  }
  const problems: string[] = [];
  if (e.text_contains) {
    const ok = await page
      .getByText(e.text_contains)
      .first()
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) problems.push(`text "${e.text_contains}" not seen`);
  }
  if (e.url_contains && !page.url().includes(e.url_contains)) problems.push("url did not match");
  if (response) {
    const r = await response.catch(() => undefined);
    if (!r) problems.push("expected request not observed");
    else if (e.request?.status_2xx !== false && !(r.status() >= 200 && r.status() < 300))
      problems.push(`request returned ${r.status()}`);
  }
  return problems.length ? `action done; expectation failed: ${problems.join("; ")}` : "ok";
}

/** Adapts the shared LlmAgent to Vedha's provider-independent Actor interface. */
class LlmActor implements Actor {
  readonly name = "LlmActor(minimax)";
  chars = 0;
  constructor(
    readonly agent: LlmAgent,
    private readonly origin: string,
  ) {}
  async decide(input: { feedback: string }): Promise<ActorDecision> {
    // The framework's own feedback (outcome, hints, recoveries, page view) goes to the model as is.
    this.chars += input.feedback.length;
    let feedback = input.feedback;
    for (let tries = 0; ; tries++) {
      if (tries >= 3) return { kind: "done", summary: "false|model produced no valid action" };
      const d = await this.agent.decide(feedback, this.origin);
      if (d.kind === "done") return { kind: "done", summary: `${d.success}|${d.summary}` };
      if (d.kind === "act") return { kind: "act", spec: d.spec };
      feedback = `Invalid response (${d.reason}). Call exactly one tool.\n${input.feedback}`;
    }
  }
}

/**
 * Arm B: same model/prompt/tools, but actions run through Vedha's explore loop (verified
 * postconditions, bounded recovery, hints, shared feedback rendering).
 *
 * Harness claim rule: pass = the model says success AND every mutating step is verified AND none is
 * outcome_unknown. Failed non-mutating steps are recorded in the diagnostic but do not veto.
 */
export async function runVedhaArm(ctx: ArmContext): Promise<ArmOutcome> {
  const before = { p: ctx.gw.promptTokens, c: ctx.gw.completionTokens, calls: ctx.gw.calls };
  const page = await (
    await ctx.browser.newContext({ viewport: { width: 1000, height: 800 } })
  ).newPage();
  const session = await Session.create(PlaywrightAdapter.fromPage(page), {
    allowedDomains: [new URL(ctx.baseUrl).hostname],
  });
  const agent = new LlmAgent(ctx.gw, ctx.goal);
  try {
    const actor = new LlmActor(agent, ctx.baseUrl);
    const res = await explore(session, actor, {
      goal: ctx.goal,
      startUrl: ctx.baseUrl,
      maxSteps: MAX_STEPS,
    });
    const mutating = session.results.filter((_, i) => session.specs[i]?.mutating);
    const claimedSuccess = res.stoppedBecause === "actor_done" && res.summary.startsWith("true|");
    const unknown = session.results.some((r) => r.status === "outcome_unknown");
    const badMutating = mutating.find((r) => r.status !== "verified");
    let claim: DriverOutcome["claim"];
    if (unknown) claim = "uncertain";
    else if (!claimedSuccess || badMutating) claim = "fail";
    else claim = "pass";
    const bad = badMutating ?? session.results.find((r) => r.status === "failed");
    return {
      claim,
      browserActions: session.results.length,
      observationChars: actor.chars,
      recoveries: session.results.reduce((n, r) => n + r.recoveries.length, 0),
      diagnostic: `${res.stoppedBecause}; failedSteps=${res.failedSteps}; ${
        bad ? `${bad.actionId}: ${describe(bad)}` : res.summary.slice(0, 200)
      }`.slice(0, 300),
      ...tokensOf(ctx.gw, before),
      transcript: agent.messages,
    };
  } finally {
    await page.context().close();
  }
}

const describe = (r: ActionResult): string => describeResult(r).join("; ");
