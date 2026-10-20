import type { ActionResult, ActionSpec } from "./types.js";

/** Error classes raised before any input reached the page, so the same action cannot have had an effect. */
const NOT_DISPATCHED: ReadonlySet<string> = new Set([
  "invalid_action",
  "not_found",
  "strict_violation",
  "blocked_by_overlay",
  "not_actionable",
  "policy_blocked",
  "repeat_refused",
]);

/**
 * Could repeating this step cause its effect twice? Only mutating steps can. A mutating step is
 * safe to repeat when it verified (nothing to repeat) or provably never reached the page.
 */
export function effectPossible(spec: ActionSpec, r: ActionResult): boolean {
  if (!spec.mutating) return false;
  if (r.status === "verified" || r.status === "unverified") return false;
  if (r.status === "outcome_unknown") return true;
  return !(r.error && NOT_DISPATCHED.has(r.error.code));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Refuses to run the same mutating action again while an earlier attempt's effect is unresolved.
 * "Same" = same op/target/value, or the same stated intent. Applies to any actor (explore loop, MCP
 * server): the model may keep working, it just cannot double-submit.
 */
export class RepeatGuard {
  private readonly open = new Map<string, string>();

  private keys(spec: ActionSpec): string[] {
    return [
      `a:${JSON.stringify([spec.op, spec.target, spec.value, spec.to])}`,
      `i:${norm(spec.intent)}`,
    ];
  }

  /** A refusal message, or undefined when the step may run. */
  refuses(spec: ActionSpec): string | undefined {
    if (!spec.mutating) return undefined;
    for (const k of this.keys(spec)) {
      const earlier = this.open.get(k);
      if (earlier)
        return `refused: "${earlier}" did the same thing and its effect is unknown, so repeating it could happen twice`;
    }
    return undefined;
  }

  record(spec: ActionSpec, r: ActionResult): void {
    if (!effectPossible(spec, r)) return;
    for (const k of this.keys(spec)) this.open.set(k, r.actionId);
  }

  /** The effect of `actionId` was confirmed (or the caller knows it did not happen). */
  resolve(actionId: string): void {
    for (const [k, id] of this.open) if (id === actionId) this.open.delete(k);
  }

  /** Explicit override for a caller that knows the effect did not happen. */
  clear(): void {
    this.open.clear();
  }
}

export const REFUSED_HINT =
  "check the page; to confirm the effect run a non-mutating step with an expectation and confirms set to the earlier step id";
