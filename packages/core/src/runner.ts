import { AdapterError } from "./adapter.js";
import type { BrowserAdapter } from "./adapter.js";
import { urlAllowed } from "./policy.js";
import type { Trace } from "./trace.js";
import { SCHEMAS } from "./types.js";
import type {
  ActionResult,
  ActionSpec,
  ActionStatus,
  AdapterErrorCode,
  ErrorInfo,
  Policy,
  RecoveryRecord,
  Target,
  Verdict,
  Verifier,
} from "./types.js";
import { runVerifier, runVerifiers, sleep } from "./verifiers.js";

export interface RunnerContext {
  adapter: BrowserAdapter;
  policy: Policy;
  trace: Trace;
  /** Upper bound on perform attempts per action (original + recoveries). */
  maxAttempts?: number;
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const RECOVERY_CLICK_TIMEOUT_MS = 1200;
const ALT_TARGET_TIMEOUT_MS = 1500;

function toAdapterError(e: unknown): AdapterError {
  if (e instanceof AdapterError) return e;
  return new AdapterError("other", e instanceof Error ? e.message : String(e));
}

function info(e: AdapterError): ErrorInfo {
  return { code: e.code, message: e.message.split("\n")[0]!.slice(0, 300) };
}

const OVERLAYISH: AdapterErrorCode[] = [
  "blocked_by_overlay",
  "timeout",
  "not_actionable",
  "not_found",
];
const LOCATABLE: AdapterErrorCode[] = [
  "not_found",
  "timeout",
  "strict_violation",
  "not_actionable",
];

/** Read-back checks derived from the action itself. Click/press/goto are not derivable. */
function implicitPostconditions(spec: ActionSpec): Verifier[] {
  if (!spec.target) return [];
  // select is excluded: option label vs value differences would make a read-back unreliable.
  if (spec.op === "fill" && spec.value !== undefined) {
    return [{ type: "value", target: spec.target, equals: spec.value }];
  }
  if (spec.op === "check") return [{ type: "state", target: spec.target, state: "checked" }];
  return [];
}

function hideImplicit(v: Verdict): Verdict {
  const verifier =
    v.verifier.type === "value" ? { ...v.verifier, equals: "[implicit]" } : v.verifier;
  const detail =
    v.status === "pass"
      ? "implicit read-back matched"
      : "implicit read-back did not match the entered value";
  return { ...v, verifier, detail, implicit: true };
}

/**
 * Executes one ActionSpec:
 *  1. policy gates -> 2. preconditions -> 3. perform (with a bounded, recorded recovery ladder for
 *  failures that happen before the input is dispatched) -> 4. independent postcondition
 *  verification -> 5. for mutating actions with an uncertain outcome: reconcile, never blind retry.
 */
export async function executeAction(spec: ActionSpec, ctx: RunnerContext): Promise<ActionResult> {
  const started = Date.now();
  const timeout = spec.timeoutMs ?? ctx.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = ctx.maxAttempts ?? 3;
  const { adapter, policy, trace } = ctx;
  const recoveries: RecoveryRecord[] = [];
  let attempts = 0;
  let usedTarget: Target | undefined = spec.target;
  let verdicts: Verdict[] = [];

  trace.emit("step_started", {
    id: spec.id,
    intent: spec.intent,
    op: spec.op,
    mutating: !!spec.mutating,
  });

  const finish = (
    status: ActionStatus,
    extra: { error?: ErrorInfo; note?: string } = {},
  ): ActionResult => {
    const recovered =
      (status === "verified" || status === "unverified") &&
      recoveries.some((r) => r.outcome === "succeeded");
    const result: ActionResult = {
      schema: SCHEMAS.actionResult,
      actionId: spec.id,
      status,
      recovered,
      verdicts,
      recoveries,
      attempts,
      usedTarget,
      durationMs: Date.now() - started,
      ...extra,
    };
    trace.emit("step_finished", {
      id: spec.id,
      status,
      recovered,
      attempts,
      error: extra.error,
      note: extra.note,
    });
    return result;
  };

  // 1. Policy gates.
  if (spec.destructive && policy.destructiveRequiresApproval && !policy.approveDestructive) {
    trace.emit("policy_block", { id: spec.id, reason: "destructive action requires approval" });
    return finish("blocked", {
      error: { code: "policy_blocked", message: "destructive action requires explicit approval" },
    });
  }
  if (spec.op === "goto") {
    const verdict = urlAllowed(spec.value ?? "", policy);
    if (!verdict.allowed) {
      trace.emit("policy_block", { id: spec.id, reason: verdict.reason });
      return finish("blocked", {
        error: { code: "policy_blocked", message: verdict.reason ?? "url not allowed" },
      });
    }
  }

  // 2. Preconditions (no recovery: they describe the world the action assumes).
  if (spec.preconditions?.length) {
    const pre = await runVerifiers(spec.preconditions, {
      adapter,
      timeoutMs: Math.min(timeout, 2000),
      sinceIndex: adapter.networkLog().length,
    });
    verdicts = pre;
    const bad = pre.find((v) => v.status !== "pass");
    if (bad) {
      return finish("failed", {
        error: { code: "other", message: `precondition failed: ${bad.detail}` },
      });
    }
  }

  const sinceIndex = adapter.networkLog().length;

  const attempt = async (
    target: Target | undefined,
    t: number,
  ): Promise<AdapterError | undefined> => {
    attempts++;
    trace.emit("action", { id: spec.id, op: spec.op, target, attempt: attempts });
    try {
      await adapter.perform(spec.op, target, spec.value, t);
      return undefined;
    } catch (e) {
      return toAdapterError(e);
    }
  };

  const record = (
    strategy: RecoveryRecord["strategy"],
    originalError: ErrorInfo,
    detail: string,
    ok: boolean,
  ) => {
    const rec: RecoveryRecord = {
      strategy,
      originalError,
      detail,
      outcome: ok ? "succeeded" : "failed",
    };
    recoveries.push(rec);
    trace.emit("recovery", { id: spec.id, ...rec });
  };

  // 3. Perform with ladder.
  let err = await attempt(spec.target, timeout);
  const originalError = err ? info(err) : undefined;
  let dismissRounds = 0;
  let transient = 0;
  let altIndex = 0;
  while (err && attempts < maxAttempts + (spec.altTargets?.length ?? 0)) {
    if (err.code === "policy_blocked") return finish("blocked", { error: info(err) });
    if (err.dispatched && spec.mutating) break; // input may have landed: handled by reconcile below

    const altRemaining = !!spec.altTargets && altIndex < spec.altTargets.length;
    // not_found with alternates still untried: locate first, dismiss only if the alternate turns out blocked.
    if (
      OVERLAYISH.includes(err.code) &&
      !(err.code === "not_found" && altRemaining) &&
      spec.dismiss?.length &&
      dismissRounds < 2
    ) {
      dismissRounds++;
      let dismissed = 0;
      for (const d of spec.dismiss) {
        try {
          await adapter.perform("click", d, undefined, RECOVERY_CLICK_TIMEOUT_MS);
          dismissed++;
        } catch {
          /* interstitial not present: ignore */
        }
      }
      if (dismissed > 0) {
        const next = await attempt(usedTarget, timeout);
        record("dismiss_interstitial", info(err), `dismissed ${dismissed} interstitial(s)`, !next);
        err = next;
        continue;
      }
    }
    if (LOCATABLE.includes(err.code) && spec.altTargets && altIndex < spec.altTargets.length) {
      const alt = spec.altTargets[altIndex++]!;
      const next = await attempt(alt, ALT_TARGET_TIMEOUT_MS);
      record("alt_target", info(err), `tried ${JSON.stringify(alt)}`, !next);
      // An alternate that resolved but was blocked/not actionable is the right element: keep it for the next rung.
      if (!next || next.code === "blocked_by_overlay" || next.code === "not_actionable")
        usedTarget = alt;
      err = next;
      continue;
    }
    if (
      !spec.mutating &&
      transient < 1 &&
      ["other", "disconnected", "timeout"].includes(err.code)
    ) {
      transient++;
      await sleep(100);
      const next = await attempt(usedTarget, timeout);
      record("retry_transient", info(err), "re-issued non-mutating action", !next);
      err = next;
      continue;
    }
    break;
  }

  if (err && !(err.dispatched && spec.mutating)) {
    return finish("failed", { error: originalError ?? info(err) });
  }

  // 4. Independent verification.
  const declared = spec.postconditions ?? [];
  // Fill/select/check with no declared postcondition get a derived read-back check so that the
  // most common input steps do not leave the whole run "unverified". Values are never echoed.
  const implicit = declared.length === 0 ? implicitPostconditions(spec) : [];
  const post = declared.length ? declared : implicit;
  const dispatchedUncertain = !!err; // only true here for mutating+dispatched
  verdicts = dispatchedUncertain
    ? []
    : await runVerifiers(post, { adapter, timeoutMs: timeout, sinceIndex });
  if (implicit.length) verdicts = verdicts.map(hideImplicit);
  trace.emit("verdict", {
    id: spec.id,
    verdicts: verdicts.map((v) => ({ type: v.verifier.type, status: v.status, detail: v.detail })),
  });

  if (!dispatchedUncertain) {
    if (post.length === 0) return finish("unverified", { note: "no postconditions declared" });
    if (verdicts.every((v) => v.status === "pass")) return finish("verified");
    if (!spec.mutating) {
      const bad = verdicts.find((v) => v.status !== "pass")!;
      return finish("failed", {
        error: { code: "other", message: `postcondition failed: ${bad.detail}` },
      });
    }
  }

  // 5. Mutating action with failed/unobserved postconditions or possibly-dispatched failure.
  let attemptsLeft = 1;
  for (;;) {
    const failing = verdicts.find((v) => v.status !== "pass");
    const cause: ErrorInfo = err
      ? info(err)
      : { code: "other", message: `postcondition failed: ${failing?.detail ?? "unobserved"}` };

    // The server accepted the request (2xx) but the result is wrong: the effect likely happened, so never re-issue.
    if (
      verdicts.some(
        (v) =>
          v.definitive &&
          v.observedStatus !== undefined &&
          v.observedStatus >= 200 &&
          v.observedStatus < 300,
      )
    ) {
      return finish("failed", {
        error: cause,
        note: "server accepted the request but the response contradicted the postcondition; not re-issued",
      });
    }
    if (!spec.reconcile) {
      if (verdicts.some((v) => v.definitive)) return finish("failed", { error: cause });
      return finish("outcome_unknown", {
        error: cause,
        note: "mutating action with unobserved outcome and no reconcile probe; not re-issued",
      });
    }
    const probe = await runVerifier(spec.reconcile, {
      adapter,
      timeoutMs: Math.min(timeout, 2000),
      sinceIndex: adapter.networkLog().length,
    });
    if (probe.status === "pass" && !verdicts.some((v) => v.definitive)) {
      verdicts = [
        ...verdicts.map(
          (v): Verdict =>
            v.status === "pass"
              ? v
              : {
                  ...v,
                  status: "unverifiable",
                  detail: `${v.detail} (confirmed instead by reconcile probe)`,
                },
        ),
        probe,
      ];
      return finish("verified", { note: "effect confirmed by reconcile probe; not re-issued" });
    }
    if (probe.status === "pass") {
      // Effect exists but a postcondition observed a contradiction: report, do not re-issue.
      verdicts = [...verdicts, probe];
      return finish("failed", { error: cause });
    }
    // Effect confirmed absent => re-issuing is safe.
    if (attemptsLeft <= 0) {
      verdicts = [...verdicts, probe];
      return finish("failed", { error: cause });
    }
    attemptsLeft--;
    const beforeRetry = adapter.networkLog().length;
    const next = await attempt(usedTarget, timeout);
    if (next) {
      record(
        "retry_transient",
        cause,
        `reconcile showed no effect; re-issue failed: ${next.message.split("\n")[0]}`,
        false,
      );
      return finish("failed", { error: cause });
    }
    verdicts = await runVerifiers(post, { adapter, timeoutMs: timeout, sinceIndex: beforeRetry });
    const ok = verdicts.length > 0 && verdicts.every((v) => v.status === "pass");
    record(
      "retry_transient",
      cause,
      "reconcile showed no effect; action re-issued once safely",
      ok,
    );
    if (ok) return finish("verified");
    err = undefined;
  }
}
