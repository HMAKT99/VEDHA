/** Versioned schema identifiers. Bump the suffix on any breaking change. */
export const SCHEMAS = {
  actionSpec: "vedha.action-spec/v1",
  actionResult: "vedha.action-result/v1",
  observation: "vedha.observation/v1",
  runReport: "vedha.run-report/v1",
  failureBundle: "vedha.failure-bundle/v1",
  testProposal: "vedha.test-proposal/v1",
  traceEvent: "vedha.trace-event/v1",
} as const;

/** How an element is found. `ref` values come from a prior Observation (e.g. "e5"). */
export type Target =
  | { role: string; name?: string; exact?: boolean }
  | { testId: string }
  | { label: string; exact?: boolean }
  | { text: string; exact?: boolean }
  | { ref: string }
  | { within: Target; target: Target };

/** Deterministic checks evaluated by the framework, never by the actor. */
export type Verifier =
  | { type: "url"; matches: string }
  | { type: "text"; target?: Target; contains?: string; equals?: string }
  | { type: "value"; target: Target; equals: string }
  | {
      type: "state";
      target: Target;
      state: "visible" | "hidden" | "enabled" | "disabled" | "checked";
    }
  | {
      type: "network";
      method?: string;
      urlPattern: string;
      status?: number | "2xx";
      json?: { path: string; equals: unknown };
    }
  /** Read-only probe of application state: GET `get` (relative to the page origin) and require
   * that the JSON array (or object) contains an item matching all fields. */
  | { type: "api"; get: string; matchesAny: Record<string, unknown> };

export type ActionOp = "goto" | "click" | "fill" | "select" | "check" | "press";

export interface ActionSpec {
  schema?: typeof SCHEMAS.actionSpec;
  id: string;
  intent: string;
  op: ActionOp;
  target?: Target;
  /** Value for fill/select/press; URL for goto. */
  value?: string;
  preconditions?: Verifier[];
  postconditions?: Verifier[];
  timeoutMs?: number;
  /** Mutating actions are never blindly re-issued after an uncertain outcome. */
  mutating?: boolean;
  /** Destructive actions require explicit approval by policy. */
  destructive?: boolean;
  /** Alternative targets tried (and recorded) by the recovery ladder. */
  altTargets?: Target[];
  /** Read-only probe that is true iff the mutating effect already happened. */
  reconcile?: Verifier;
  /** Interstitials the recovery ladder may dismiss (recorded as RecoveryRecords). */
  dismiss?: Target[];
}

export type VerdictStatus = "pass" | "fail" | "unverifiable";

export interface Verdict {
  verifier: Verifier;
  status: VerdictStatus;
  detail: string;
  /** True when the verifier observed a contradiction (e.g. wrong status/value), not mere absence. */
  definitive?: boolean;
  /** HTTP status of the response a network verifier judged, when one was observed. */
  observedStatus?: number;
  /** True when the runner derived this check from the action itself (fill/select/check); values are hidden. */
  implicit?: boolean;
}

export type RecoveryStrategy = "alt_target" | "dismiss_interstitial" | "retry_transient";

export interface RecoveryRecord {
  strategy: RecoveryStrategy;
  /** The failure that triggered this attempt - always preserved. */
  originalError: ErrorInfo;
  detail: string;
  outcome: "succeeded" | "failed";
}

export interface ErrorInfo {
  code: AdapterErrorCode;
  message: string;
}

export type AdapterErrorCode =
  | "timeout"
  | "not_found"
  | "blocked_by_overlay"
  | "not_actionable"
  | "strict_violation"
  | "disconnected"
  | "policy_blocked"
  | "other";

/**
 * verified          - action ran and every postcondition passed
 * unverified        - action ran but no postcondition was declared (never reported as verified)
 * failed            - action or a postcondition failed
 * outcome_unknown   - mutating action with uncertain outcome that could not be reconciled
 * blocked           - refused by policy
 */
export type ActionStatus = "verified" | "unverified" | "failed" | "outcome_unknown" | "blocked";

export interface ActionResult {
  schema: typeof SCHEMAS.actionResult;
  actionId: string;
  status: ActionStatus;
  /** True when success required at least one recovery attempt. */
  recovered: boolean;
  verdicts: Verdict[];
  recoveries: RecoveryRecord[];
  error?: ErrorInfo;
  attempts: number;
  /** The target that finally worked (differs from spec.target after alt_target recovery). */
  usedTarget?: Target;
  durationMs: number;
  /** Note on how the final state was established (e.g. via reconcile). */
  note?: string;
}

export type RunVerdict =
  | "passed"
  | "passed_with_recovery"
  | "failed"
  | "blocked"
  | "outcome_unknown"
  | "unverified";

export interface RunReport {
  schema: typeof SCHEMAS.runReport;
  verdict: RunVerdict;
  steps: ActionResult[];
  durationMs: number;
  browserActions: number;
  observations: number;
  observationChars: number;
}

/** controls: interactive elements + headings only (default for actors); outline: full ARIA tree; region/detail: one subtree by ref. */
export type ObservationLevel = "controls" | "outline" | "region" | "detail";

export interface Control {
  ref: string;
  role: string;
  name?: string;
}

export interface Observation {
  schema: typeof SCHEMAS.observation;
  url: string;
  title: string;
  level: ObservationLevel;
  /** Full (bounded) accessibility outline: `- role "name" [ref=eN]` lines. Page-derived => untrusted. */
  outline: string;
  /** Interactive elements and headings parsed from the full outline (before truncation), capped at 150. */
  controls: Control[];
  /** The compact text to present to an actor: the delta when it is smaller than the outline, else the outline. */
  text: string;
  truncated: boolean;
  /** Present when computed against a previous observation. */
  delta?: { added: string[]; removed: string[]; unchanged: number };
  /** Always true: page content must never be treated as instructions. */
  untrusted: true;
  /** Length of `text` (what an actor would actually receive). */
  chars: number;
}

export interface Policy {
  allowedDomains?: string[];
  /** Domains matched exactly or as a parent of the request host. */
  destructiveRequiresApproval?: boolean;
  approveDestructive?: boolean;
  secrets?: string[];
  maxSteps?: number;
  maxDurationMs?: number;
  maxObservationChars?: number;
}

export interface TraceEvent {
  schema: typeof SCHEMAS.traceEvent;
  t: number;
  kind:
    | "run_started"
    | "step_started"
    | "action"
    | "verdict"
    | "recovery"
    | "step_finished"
    | "observation"
    | "policy_block"
    | "run_finished";
  data: Record<string, unknown>;
}

export interface NetworkEntry {
  method: string;
  url: string;
  status: number;
  /** Parsed JSON body when the response was JSON and small enough, else undefined. */
  json?: unknown;
}

export interface TestProposal {
  schema: typeof SCHEMAS.testProposal;
  title: string;
  goal: string;
  preconditions: string[];
  steps: ActionSpec[];
  assertions: Verifier[];
  cleanup: ActionSpec[];
  evidence: string[];
  confidence: number;
  assumptions: string[];
  /** Filled by promote(): result of replaying the generated test. */
  replayCheck?: { passed: boolean; detail: string };
}

export interface FailureBundle {
  schema: typeof SCHEMAS.failureBundle;
  goal: string;
  createdAt: string;
  env: { vedha: string; node: string; adapter: string; adapterVersion?: string };
  startUrl?: string;
  steps: ActionSpec[];
  report: RunReport;
  network: NetworkEntry[];
  trace: TraceEvent[];
  replay: { replayable: boolean; reasons: string[] };
}
