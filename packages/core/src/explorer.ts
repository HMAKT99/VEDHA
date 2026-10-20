import { renderFeedback } from "./feedback.js";
import { REFUSED_HINT, RepeatGuard } from "./repeatGuard.js";
import { proposalFromSession } from "./promote.js";
import type { Session } from "./session.js";
import type {
  ActionResult,
  ActionSpec,
  Observation,
  ObservationLevel,
  TestProposal,
  Verifier,
} from "./types.js";

export type ActorDecision = { kind: "act"; spec: ActionSpec } | { kind: "done"; summary: string };

/** Provider-independent decision interface. LLM-backed actors implement this externally. */
export interface Actor {
  readonly name: string;
  decide(input: {
    goal: string;
    observation: Observation;
    history: ActionResult[];
    step: number;
    /** Ready-to-show text: the previous step's outcome (failed checks, hints, recoveries) and the page. */
    feedback: string;
    /** True on the single last call after the failure limit: only `done` is accepted (browser-use does the same). */
    final?: boolean;
  }): Promise<ActorDecision>;
}

export interface ExploreOptions {
  goal: string;
  title?: string;
  startUrl: string;
  maxSteps?: number;
  finalAssertions?: Verifier[];
  /**
   * What to do when a step does not verify. `feed_back` (default) shows the failure to the actor and
   * continues (a RepeatGuard still refuses to run a mutating action again while its earlier outcome
   * is unresolved); `stop` ends at the first failure.
   */
  onStepFailure?: "feed_back" | "stop";
  /** Consecutive failed steps after which exploration ends (default 3). */
  maxConsecutiveFailures?: number;
  /** Observation requested each step; `delta` shows only changes (default: full view). */
  observation?: { level?: ObservationLevel; delta?: boolean };
}

export interface ExploreResult {
  summary: string;
  stoppedBecause: "actor_done" | "max_steps" | "step_failed";
  /** The actor's last-chance report after the failure limit, when it gave one. */
  finalReport?: string;
  /** Steps that did not verify, including ones the actor later worked around. Never hidden. */
  failedSteps: number;
  proposal: TestProposal;
}

/**
 * Autonomous loop: observe -> actor.decide -> verified execution -> record.
 * Every proposed action goes through the same runner, policy and verifiers as deterministic runs.
 */
export async function explore(
  session: Session,
  actor: Actor,
  opts: ExploreOptions,
): Promise<ExploreResult> {
  const maxSteps = opts.maxSteps ?? 15;
  const maxConsecutive = opts.maxConsecutiveFailures ?? 3;
  const mode = opts.onStepFailure ?? "feed_back";
  const delta = opts.observation?.delta ?? false;
  await session.step({
    id: "open",
    intent: "open the start page",
    op: "goto",
    value: opts.startUrl,
    postconditions: [{ type: "url", matches: new URL(opts.startUrl, "http://x").pathname }],
  });
  let stopped: ExploreResult["stoppedBecause"] = "max_steps";
  let summary = "";
  let failedSteps = 0;
  let finalReport: string | undefined;
  let consecutive = 0;
  const guard = new RepeatGuard();
  for (let i = 0; i < maxSteps; i++) {
    const observation = await session.observe({
      level: opts.observation?.level ?? "outline",
      delta: delta && i > 0,
    });
    const decision = await actor.decide({
      goal: opts.goal,
      observation,
      history: session.results,
      step: i,
      feedback: renderFeedback(i > 0 ? session.results.at(-1) : undefined, observation, {
        mode: delta ? "text" : "auto",
      }),
    });
    if (decision.kind === "done") {
      stopped = "actor_done";
      summary = decision.summary;
      break;
    }
    const refusal = guard.refuses(decision.spec);
    const r = refusal
      ? session.reject(decision.spec, refusal, REFUSED_HINT)
      : await session.step(decision.spec);
    if (!refusal) {
      guard.record(decision.spec, r);
      const confirmed = decision.spec.confirms;
      if (confirmed && session.results.find((x) => x.actionId === confirmed)?.confirmedBy)
        guard.resolve(confirmed);
    }
    if (r.status === "verified" || r.status === "unverified") {
      consecutive = 0;
      continue;
    }
    failedSteps++;
    consecutive++;
    if (mode === "stop" || consecutive >= maxConsecutive) {
      stopped = "step_failed";
      summary = `step ${decision.spec.id} ended ${r.status}`;
      if (mode !== "stop") {
        // One last turn that may only report: an honest end state beats a silent stop.
        const obs = await session.observe({ level: opts.observation?.level ?? "outline" });
        const last = await actor.decide({
          goal: opts.goal,
          observation: obs,
          history: session.results,
          step: i + 1,
          final: true,
          feedback: `${renderFeedback(session.results.at(-1), obs)}\n\nThe run is ending after ${consecutive} consecutive failed steps. Report what you found; say whether the task was completed.`,
        });
        if (last.kind === "done") finalReport = last.summary;
      }
      break;
    }
  }
  const proposal = proposalFromSession(session, {
    title: opts.title ?? opts.goal,
    goal: opts.goal,
    finalAssertions: opts.finalAssertions,
  });
  return {
    summary,
    stoppedBecause: stopped,
    failedSteps,
    proposal,
    ...(finalReport ? { finalReport } : {}),
  };
}

export interface RuleGoal {
  /** Accessible-name pattern -> value to type, in order. */
  fields: Array<{ name: RegExp; value: string; role: "textbox" | "spinbutton" | "combobox" }>;
  submit: { name: RegExp; mutating: boolean; postconditions: Verifier[]; reconcile?: Verifier };
}

/**
 * Heuristic, non-LLM actor used in benchmarks and examples: fills the listed fields then submits.
 * It reads only the outline (page content is untrusted data, never instructions).
 */
export class RuleActor implements Actor {
  readonly name = "RuleActor";
  constructor(private readonly rule: RuleGoal) {}

  async decide(input: {
    observation: Observation;
    history: ActionResult[];
  }): Promise<ActorDecision> {
    const done = new Set(
      input.history
        .filter((h) => h.status === "verified" || h.status === "unverified")
        .map((h) => h.actionId),
    );
    // Use the last full outline when the observation is a delta of nothing.
    const entries = input.observation.controls;
    for (const f of this.rule.fields) {
      const id = `fill:${f.name.source}`;
      if (done.has(id)) continue;
      const e = entries.find((x) => x.role === f.role && x.name && f.name.test(x.name));
      if (!e) continue;
      const target = { role: e.role, name: e.name } as const;
      const verb = f.role === "combobox" ? "select" : "fill";
      return {
        kind: "act",
        spec: {
          id,
          intent: `${verb} ${e.name}`,
          op: f.role === "combobox" ? "select" : "fill",
          target,
          value: f.value,
          postconditions: f.role === "combobox" ? [] : [{ type: "value", target, equals: f.value }],
        },
      };
    }
    if (!done.has("submit")) {
      const e = entries.find(
        (x) => x.role === "button" && x.name && this.rule.submit.name.test(x.name),
      );
      if (e) {
        return {
          kind: "act",
          spec: {
            id: "submit",
            intent: `click ${e.name}`,
            op: "click",
            target: { role: "button", name: e.name },
            mutating: this.rule.submit.mutating,
            postconditions: this.rule.submit.postconditions,
            reconcile: this.rule.submit.reconcile,
          },
        };
      }
    }
    return {
      kind: "done",
      summary: done.has("submit") ? "submitted" : "no actionable controls found",
    };
  }
}
