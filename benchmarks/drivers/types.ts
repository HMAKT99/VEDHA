import type { Scenario } from "../scenarios/index.js";

export interface DriverOutcome {
  /** What the driver reports to its caller. */
  claim: "pass" | "fail" | "uncertain";
  browserActions: number;
  /** Characters of page observation returned to the (hypothetical) actor. */
  observationChars: number;
  recoveries: number;
  /** Human-readable per-run diagnostic text produced by the driver on failure. */
  diagnostic: string;
  notes?: string;
}

export interface Driver {
  id: string;
  description: string;
  /** Called once per worker (e.g. to launch a browser). */
  setup(): Promise<void>;
  run(scenario: Scenario, baseUrl: string): Promise<DriverOutcome>;
  teardown(): Promise<void>;
}
