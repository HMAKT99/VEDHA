import type { BrowserAdapter } from "./adapter.js";
import { observeWithBasis } from "./observation.js";
import { executeAction } from "./runner.js";
import { Trace } from "./trace.js";
import { SCHEMAS } from "./types.js";
import type {
  ActionResult,
  ActionSpec,
  Observation,
  ObservationLevel,
  Policy,
  RunReport,
  RunVerdict,
} from "./types.js";

export function summarize(all: ActionResult[]): RunVerdict {
  // A refused repeat never ran; it stays visible in the steps but does not decide the verdict.
  const results = all.filter((r) => r.error?.code !== "repeat_refused");
  if (results.some((r) => r.status === "blocked")) return "blocked";
  if (results.some((r) => r.status === "failed" && !r.confirmedBy)) return "failed";
  // An unknown outcome later confirmed by an independent check no longer makes the run unknown.
  if (results.some((r) => r.status === "outcome_unknown" && !r.confirmedBy))
    return "outcome_unknown";
  // An unchecked enabling step is vouched for by any later verified step.
  if (
    results.some(
      (r, i) =>
        r.status === "unverified" &&
        !(r.enabling && results.slice(i + 1).some((x) => x.status === "verified")),
    )
  )
    return "unverified";
  if (results.some((r) => r.recovered || r.confirmedBy)) return "passed_with_recovery";
  return "passed";
}

/** A browsing session: adapter + policy + trace + per-step results. */
export class Session {
  readonly trace: Trace;
  readonly results: ActionResult[] = [];
  readonly specs: ActionSpec[] = [];
  startUrl?: string;
  private last?: Observation;
  private observations = 0;
  private observationChars = 0;
  private readonly t0 = Date.now();

  private constructor(
    readonly adapter: BrowserAdapter,
    readonly policy: Policy,
  ) {
    this.trace = new Trace(policy.secrets ?? []);
  }

  static async create(adapter: BrowserAdapter, policy: Policy = {}): Promise<Session> {
    await adapter.applyPolicy(policy);
    const s = new Session(adapter, policy);
    s.trace.emit("run_started", {
      adapter: adapter.name,
      policy: { ...policy, secrets: undefined },
    });
    return s;
  }

  /** Executes one action. Enforces step and duration budgets from policy. */
  async step(spec: ActionSpec): Promise<ActionResult> {
    const { maxSteps, maxDurationMs } = this.policy;
    let result: ActionResult;
    if (maxSteps !== undefined && this.results.length >= maxSteps) {
      result = this.budgetBlock(spec, `maxSteps (${maxSteps}) exceeded`);
    } else if (maxDurationMs !== undefined && Date.now() - this.t0 > maxDurationMs) {
      result = this.budgetBlock(spec, `maxDurationMs (${maxDurationMs}) exceeded`);
    } else {
      if (!this.startUrl && spec.op === "goto") this.startUrl = spec.value;
      result = await executeAction(spec, {
        adapter: this.adapter,
        policy: this.policy,
        trace: this.trace,
      });
    }
    this.specs.push(spec);
    this.results.push(result);
    this.applyConfirmation(spec, result);
    return result;
  }

  /** A verified step with a declared check can confirm an earlier unresolved step (unknown outcome, or a check that was not met while the page was idle). */
  private applyConfirmation(spec: ActionSpec, result: ActionResult): void {
    if (!spec.confirms || result.status !== "verified") return;
    if (!spec.postconditions?.length) return;
    const earlier = this.results.find((r) => r.actionId === spec.confirms);
    const unresolved =
      earlier?.status === "outcome_unknown" ||
      (earlier?.status === "failed" && earlier.error?.code === "expectation_not_met");
    if (!earlier || !unresolved || earlier.confirmedBy) return;
    earlier.confirmedBy = spec.id;
    this.trace.emit("recovery", {
      id: earlier.actionId,
      strategy: "confirmed_later",
      detail: `effect confirmed afterwards by ${spec.id}`,
    });
  }

  /**
   * Records a step that was not run (for example a refused repeat) as a blocked result, so the
   * refusal appears in the report and the actor is told why.
   */
  reject(spec: ActionSpec, message: string, hint?: string): ActionResult {
    this.trace.emit("policy_block", { id: spec.id, reason: message });
    const result: ActionResult = {
      schema: SCHEMAS.actionResult,
      actionId: spec.id,
      status: "blocked",
      recovered: false,
      verdicts: [],
      recoveries: [],
      error: { code: "repeat_refused", message, ...(hint ? { hint } : {}) },
      attempts: 0,
      durationMs: 0,
    };
    this.specs.push(spec);
    this.results.push(result);
    return result;
  }

  private budgetBlock(spec: ActionSpec, message: string): ActionResult {
    this.trace.emit("policy_block", { id: spec.id, reason: message });
    return {
      schema: SCHEMAS.actionResult,
      actionId: spec.id,
      status: "blocked",
      recovered: false,
      verdicts: [],
      recoveries: [],
      error: { code: "policy_blocked", message },
      attempts: 0,
      durationMs: 0,
    };
  }

  /** Runs specs in order; stops at the first step that is not verified/unverified. */
  async run(specs: ActionSpec[]): Promise<RunReport> {
    for (const spec of specs) {
      const r = await this.step(spec);
      if (r.status !== "verified" && r.status !== "unverified") break;
    }
    const report = this.report();
    this.trace.emit("run_finished", { verdict: report.verdict });
    return report;
  }

  async observe(
    opts: { level?: ObservationLevel; ref?: string; delta?: boolean } = {},
  ): Promise<Observation> {
    const { observation: obs, full } = await observeWithBasis(this.adapter, {
      level: opts.level,
      ref: opts.ref,
      maxChars: this.policy.maxObservationChars,
      previous: opts.delta ? this.last : undefined,
    });
    this.last = full;
    this.observations++;
    this.observationChars += obs.chars;
    this.trace.emit("observation", {
      url: obs.url,
      level: obs.level,
      chars: obs.chars,
      truncated: obs.truncated,
    });
    return obs;
  }

  report(): RunReport {
    return {
      schema: SCHEMAS.runReport,
      verdict: summarize(this.results),
      steps: this.results,
      durationMs: Date.now() - this.t0,
      browserActions: this.results.reduce((n, r) => n + r.attempts, 0),
      observations: this.observations,
      observationChars: this.observationChars,
    };
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}
