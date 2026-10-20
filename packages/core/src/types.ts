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
  /** CSS selector: the least stable way to find an element, for third-party markup without roles or labels. */
  | { css: string }
  | { within: Target; target: Target }
  /** Element inside an iframe; `inFrame` is a CSS selector for the iframe element. */
  | { inFrame: string; target: Target };

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

export type ActionOp =
  | "goto"
  | "click"
  | "dblclick"
  | "hover"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "press"
  /** `value` is a file path (or comma-separated paths) inside `Policy.uploadRoots`. */
  | "upload"
  /** With a target: scroll it into view. Without: `value` is down | up | top | bottom (default down). */
  | "scroll"
  /** Drag `target` onto `to`. */
  | "drag"
  /** Wait up to `value` ms (max 5000); its postconditions do the real waiting. */
  | "wait"
  | "back"
  | "reload"
  /** `value` is first | last (default) | a zero-based tab index. */
  | "switch_tab";

export interface ActionSpec {
  schema?: typeof SCHEMAS.actionSpec;
  id: string;
  intent: string;
  op: ActionOp;
  target?: Target;
  /** Value for fill/select/press; URL for goto; see ActionOp for the other ops. */
  value?: string;
  /** Destination for `drag`. */
  to?: Target;
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
  /** URL substrings whose errors the page-health check must ignore for this step (known noisy endpoints). */
  healthIgnore?: string[];
  /**
   * Id of an earlier step whose outcome was unknown. When this step verifies (with at least one
   * declared check), that earlier effect counts as confirmed by an independent check.
   */
  confirms?: string;
  /**
   * The step only makes a later step possible (open a menu, scroll, switch tab). If it has no
   * declared check it stays `unverified`, but a later verified step stops it downgrading the run.
   * Defaults to true for hover, scroll, wait, switch_tab, back and reload.
   */
  enabling?: boolean;
  /**
   * The action's effect is synchronous (client-side, or awaited before the page updates). If a declared
   * check does not hold after the timeout, the step is `failed` rather than `outcome_unknown`. Leave it
   * off for actions whose effect can arrive late, where "unknown, not repeated" is the safe answer.
   */
  synchronous?: boolean;
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
  /** Short, actionable advice derived by the framework (never an instruction from the page). */
  hint?: string;
}

export type AdapterErrorCode =
  | "timeout"
  | "not_found"
  | "blocked_by_overlay"
  | "not_actionable"
  | "strict_violation"
  | "disconnected"
  | "policy_blocked"
  /** The op does not fit the element (e.g. fill on a dropdown). Raised before any input is sent. */
  | "invalid_action"
  /** Declared checks passed, but the page produced a server error or uncaught exception during the action. */
  | "health_check_failed"
  /** A mutating action was not run again because the same action's earlier outcome is unresolved. */
  | "repeat_refused"
  /** A declared check did not hold and the page is idle, so the effect cannot still be arriving. */
  | "expectation_not_met"
  /** The server accepted a write (2xx) but reading the resource back does not show it. */
  | "readback_contradiction"
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
  /** Dialogs, new tabs and page errors seen while the step ran (informational). */
  observed?: string[];
  /** What a convention-based read-back confirmed after the step's writes. */
  readback?: string[];
  /** Structured read-back probes (written fields visible at a GET path); promotion turns them into assertions. */
  readbackProbes?: Array<{ get: string; matchesAny: Record<string, unknown> }>;
  /** Requests the step made that matter: writes and failures, e.g. "POST /api/orders 201" (max 5). */
  requests?: string[];
  /** Set on an outcome_unknown result once a later step confirmed the effect. */
  confirmedBy?: string;
  /** The step was an enabling step (see ActionSpec.enabling). */
  enabling?: boolean;
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

/** Page-level facts an agent otherwise has to ask for (what Playwright MCP puts in every result). */
export interface PageHeader {
  tabs: Array<{ index: number; url: string; title: string; current: boolean }>;
  /** HTTP status of the current tab's main document when it was not 2xx. */
  mainStatus?: number;
  consoleErrors: number;
  consoleWarnings: number;
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
  /** Present when the adapter can report it. */
  header?: PageHeader;
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
  /**
   * Page-health check on actions: server errors (5xx, or 4xx/failed requests on non-GET calls) and
   * uncaught page exceptions seen while the action ran fail it even when its declared checks pass.
   * "mutating" (default) applies to steps marked mutating; "all" to every step; "off" disables it.
   */
  health?: "off" | "mutating" | "all";
  /** What to do with JavaScript dialogs (alert/confirm/prompt). Always recorded. Default dismiss. */
  dialogs?: "dismiss" | "accept";
  /**
   * Read-back inference after writes that returned 2xx (POST /x then GET /x ...). "on" by default for
   * the steps the page-health check covers; "off" disables it. Endpoints a step declares itself are exempt.
   */
  readback?: "on" | "off";
  /** Directories `upload` may read from. Empty or missing disables uploads (fail closed). */
  uploadRoots?: string[];
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
    | "preflight_reject"
    | "run_finished";
  data: Record<string, unknown>;
}

export interface NetworkEntry {
  method: string;
  url: string;
  status: number;
  /** Parsed JSON body when the response was JSON and small enough, else undefined. */
  json?: unknown;
  /** Parsed JSON request body for writes, when small enough. */
  requestJson?: unknown;
}

/** Browser-side problems that are not HTTP responses. */
export interface PageEvent {
  kind: "pageerror" | "requestfailed" | "dialog" | "popup";
  text: string;
  method?: string;
  url?: string;
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
  replayCheck?: {
    passed: boolean;
    detail: string;
    runs?: number;
    passes?: number;
    flaky?: boolean;
  };
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
