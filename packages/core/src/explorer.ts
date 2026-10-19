import { proposalFromSession } from "./promote.js";
import type { Session } from "./session.js";
import type { ActionResult, ActionSpec, Observation, TestProposal, Verifier } from "./types.js";

export type ActorDecision = { kind: "act"; spec: ActionSpec } | { kind: "done"; summary: string };

/** Provider-independent decision interface. LLM-backed actors implement this externally. */
export interface Actor {
  readonly name: string;
  decide(input: {
    goal: string;
    observation: Observation;
    history: ActionResult[];
    step: number;
  }): Promise<ActorDecision>;
}

export interface ExploreOptions {
  goal: string;
  title?: string;
  startUrl: string;
  maxSteps?: number;
  finalAssertions?: Verifier[];
}

export interface ExploreResult {
  summary: string;
  stoppedBecause: "actor_done" | "max_steps" | "step_failed";
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
  await session.step({
    id: "open",
    intent: "open the start page",
    op: "goto",
    value: opts.startUrl,
    postconditions: [{ type: "url", matches: new URL(opts.startUrl, "http://x").pathname }],
  });
  let stopped: ExploreResult["stoppedBecause"] = "max_steps";
  let summary = "";
  for (let i = 0; i < maxSteps; i++) {
    const observation = await session.observe({ level: "controls", delta: i > 0 });
    const decision = await actor.decide({
      goal: opts.goal,
      observation,
      history: session.results,
      step: i,
    });
    if (decision.kind === "done") {
      stopped = "actor_done";
      summary = decision.summary;
      break;
    }
    const r = await session.step(decision.spec);
    if (r.status !== "verified" && r.status !== "unverified") {
      stopped = "step_failed";
      summary = `step ${decision.spec.id} ended ${r.status}`;
      break;
    }
  }
  const proposal = proposalFromSession(session, {
    title: opts.title ?? opts.goal,
    goal: opts.goal,
    finalAssertions: opts.finalAssertions,
  });
  return { summary, stoppedBecause: stopped, proposal };
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
    const done = new Set(input.history.map((h) => h.actionId));
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
