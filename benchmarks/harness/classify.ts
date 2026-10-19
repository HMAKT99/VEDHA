import type { Scenario } from "../scenarios/index.js";
import type { DriverOutcome } from "../drivers/types.js";
import type { OracleState } from "../fixtures/shop.js";

export type Outcome =
  | "success"
  | "false_pass"
  | "false_fail"
  | "honest_fail"
  | "detected"
  | "missed"
  | "uncertain_effect_done"
  | "uncertain_no_effect"
  | "uncertain_defect"
  | "driver_error";

/** Pure classification of a trial against server-side truth. */
export function classify(
  sc: Pick<Scenario, "kind">,
  claim: DriverOutcome["claim"],
  effect: boolean,
): Outcome {
  if (sc.kind === "defect") {
    if (claim === "fail") return "detected";
    if (claim === "pass") return "missed";
    return "uncertain_defect";
  }
  if (claim === "pass") return effect ? "success" : "false_pass";
  if (claim === "fail") return effect ? "false_fail" : "honest_fail";
  return effect ? "uncertain_effect_done" : "uncertain_no_effect";
}

/** "Correct" = what a user wants: task done and reported, or defect reported. Uncertain is never correct. */
export function isCorrect(o: Outcome): boolean {
  return o === "success" || o === "detected";
}

/** Reports a pass although the truth is no effect (or a defect): the costly error. */
export function isFalsePass(o: Outcome): boolean {
  return o === "false_pass" || o === "missed";
}

export interface TrialRecord {
  runId: string;
  scenario: string;
  kind: Scenario["kind"];
  category: Scenario["category"];
  driver: string;
  trial: number;
  seed: number;
  claim: DriverOutcome["claim"] | "error";
  outcome: Outcome;
  effect: boolean;
  duplicates: number;
  postCount: number;
  latencyMs: number;
  browserActions: number;
  observationChars: number;
  recoveries: number;
  maskedDefect: boolean;
  diagnostic: string;
  notes?: string;
}

export function oracleSummary(sc: Scenario, s: OracleState) {
  return { effect: sc.effectAchieved(s), duplicates: sc.duplicates(s), postCount: s.postCount };
}
