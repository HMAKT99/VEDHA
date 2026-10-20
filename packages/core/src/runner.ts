import { AdapterError } from "./adapter.js";
import type { BrowserAdapter } from "./adapter.js";
import {
  healthApplies,
  healthFindings,
  healthWindow,
  requestSummary,
  wroteData,
} from "./health.js";
import { readBack } from "./readback.js";
import type { HealthWindow } from "./health.js";
import { hintForFailure, postconditionHint, preflightHint, roleOf } from "./hints.js";
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
import { contradictions, failFast } from "./failfast.js";

export interface RunnerContext {
  adapter: BrowserAdapter;
  policy: Policy;
  trace: Trace;
  /** Upper bound on perform attempts per action (original + recoveries). */
  maxAttempts?: number;
  defaultTimeoutMs?: number;
}

/** Ops that cannot be checked in general; they exist to make a later step possible. */
const ENABLING_OPS: ReadonlySet<string> = new Set([
  "hover",
  "scroll",
  "wait",
  "switch_tab",
  "back",
  "reload",
]);

const DEFAULT_TIMEOUT_MS = 5000;
/** First-attempt budget when alternates exist (see executeAction). */
const FAST_FIRST_MS = 2000;
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

  let health: HealthWindow | undefined;

  const finish = (
    declared: ActionStatus,
    declaredExtra: {
      error?: ErrorInfo;
      note?: string;
      readback?: string[];
      readbackProbes?: Array<{ get: string; matchesAny: Record<string, unknown> }>;
    } = {},
  ): ActionResult => {
    let status = declared;
    let extra = declaredExtra;
    // Page-health check: a step whose declared checks passed still fails if the page reported a
    // server error or uncaught exception while it ran (the UI can say "success" while the server says 500).
    if (
      (status === "verified" || status === "unverified" || status === "outcome_unknown") &&
      health &&
      (healthApplies(spec, policy) || (policy.health !== "off" && wroteData(adapter, health)))
    ) {
      const found = healthFindings(adapter, health, spec);
      if (found.length) {
        status = "failed";
        extra = {
          error: {
            code: "health_check_failed",
            message: `${
              declared === "verified"
                ? "declared checks passed"
                : declared === "outcome_unknown"
                  ? "the outcome could not be observed"
                  : "no check was declared"
            }, but the page reported: ${found.join("; ")}`,
            hint: "treat this action as failed: the server or page reported an error even if the page looks fine",
          },
          note: "page-health check",
        };
      }
    }
    // A failed step says what the page saw, not only which check was unmet.
    if (
      status === "failed" &&
      extra.error &&
      extra.error.code !== "health_check_failed" &&
      health &&
      policy.health !== "off" &&
      (healthApplies(spec, policy) || wroteData(adapter, health))
    ) {
      const found = contradictions(adapter, health, spec);
      if (found.length)
        extra = {
          ...extra,
          error: {
            ...extra.error,
            message: `${extra.error.message} (page reported: ${found.join("; ")})`,
          },
        };
    }
    if (status === "outcome_unknown" && extra.error) {
      const repeat = `do not repeat this action. Check the page, or confirm the effect with a non-mutating step that declares an expectation and sets confirms: "${spec.id}"`;
      extra = {
        ...extra,
        error: {
          ...extra.error,
          hint: extra.error.hint ? `${extra.error.hint}. Also: ${repeat}` : repeat,
        },
      };
    }
    const recovered =
      (status === "verified" || status === "unverified") &&
      recoveries.some((r) => r.outcome === "succeeded");
    const seen = health
      ? (adapter.pageEvents?.().slice(health.events) ?? [])
          .flatMap((e) =>
            e.kind === "dialog"
              ? [`dialog ${e.text}`]
              : e.kind === "popup"
                ? ["a new tab opened (switch_tab to use it)"]
                : e.kind === "pageerror"
                  ? [`page error: ${e.text.slice(0, 100)}`]
                  : [],
          )
          .slice(0, 5)
      : [];
    const requests = health ? requestSummary(adapter, health) : [];
    const wrote = !!health && wroteData(adapter, health);
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
      ...((spec.enabling ?? ENABLING_OPS.has(spec.op)) ? { enabling: true } : {}),
      ...(seen.length ? { observed: seen } : {}),
      ...(requests.length ? { requests } : {}),
      ...(wrote ? { wroteData: true } : {}),
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

  /** Like finish(), but a step that would verify first gets a convention-based read-back of its writes. */
  const finishChecked = async (
    declared: ActionStatus,
    extra: {
      error?: ErrorInfo;
      note?: string;
      readback?: string[];
      readbackProbes?: Array<{ get: string; matchesAny: Record<string, unknown> }>;
    } = {},
  ): Promise<ActionResult> => {
    if (
      (declared === "verified" || declared === "unverified") &&
      health &&
      (healthApplies(spec, policy) || (policy.health !== "off" && wroteData(adapter, health)))
    ) {
      const rb = await readBack(adapter, health, spec, policy);
      if (rb.contradiction) {
        return finish("failed", {
          error: {
            code: "readback_contradiction",
            message: rb.contradiction,
            hint: "the server accepted the write but the data is not there. If this endpoint legitimately does not list what was written, disable the check with policy.readback: off or list the endpoint in the step's healthIgnore",
          },
          note: "read-back inference",
        });
      }
      if (rb.confirmed.length)
        extra = {
          ...extra,
          readback: rb.confirmed,
          ...(rb.probes.length ? { readbackProbes: rb.probes } : {}),
        };
    }
    return finish(declared, extra);
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

  // 1b. Pre-flight: an op that cannot work on the stated role is reported before anything is sent.
  const mismatch = spec.op === "goto" ? undefined : preflightHint(spec);
  if (mismatch) {
    trace.emit("preflight_reject", { id: spec.id, op: spec.op, role: roleOf(spec.target) });
    return finish("failed", {
      error: {
        code: "invalid_action",
        message: `${spec.op} does not fit a ${roleOf(spec.target)} element`,
        hint: mismatch,
      },
    });
  }

  // 2. Preconditions (no recovery: they describe the world the action assumes).
  if (spec.preconditions?.length) {
    const pre = await runVerifiers(spec.preconditions, {
      adapter,
      // A server error with nothing in flight leaves little to wait for: one short look is enough.
      timeoutMs: Math.min(
        timeout,
        health && !adapter.pendingRequests?.() && contradictions(adapter, health, spec).length
          ? 300
          : 2000,
      ),
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
  health = healthWindow(adapter);

  const attempt = async (
    target: Target | undefined,
    t: number,
  ): Promise<AdapterError | undefined> => {
    attempts++;
    trace.emit("action", { id: spec.id, op: spec.op, target, attempt: attempts });
    try {
      await adapter.perform(spec.op, target, spec.value, t, { to: spec.to });
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
  // With author-supplied alternates, do not wait out the whole timeout for a target that is not there:
  // try it briefly, then the alternates, then give the primary the rest of its time (so a merely slow
  // page still gets the full wait). Recovery after a rename drops from timeout + alt to about 2 s + alt.
  const fastFirst = !!spec.altTargets?.length && spec.op !== "goto" && timeout > FAST_FIRST_MS;
  const firstBudget = fastFirst ? FAST_FIRST_MS : timeout;
  let topUp = fastFirst;
  let err = await attempt(spec.target, firstBudget);
  let originalError = err ? info(err) : undefined;
  let dismissRounds = 0;
  let transient = 0;
  let altIndex = 0;
  while (err && attempts < maxAttempts + (spec.altTargets?.length ?? 0) + (fastFirst ? 1 : 0)) {
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
    if (topUp && !altRemaining && (err.code === "not_found" || err.code === "timeout")) {
      topUp = false;
      const next = await attempt(spec.target, timeout - firstBudget);
      if (next) originalError = info(next); // report the failure after the full wait, not the short probe
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
    const failure = originalError ?? info(err);
    const hint = await hintForFailure(spec, failure.code, adapter);
    return finish("failed", { error: hint ? { ...failure, hint } : failure });
  }

  // 4. Independent verification.
  const declared = spec.postconditions ?? [];
  // Fill/select/check with no declared postcondition get a derived read-back check so that the
  // most common input steps do not leave the whole run "unverified". Values are never echoed.
  const implicit = declared.length === 0 ? implicitPostconditions(spec) : [];
  const post = declared.length ? declared : implicit;
  // Fail fast only where the final health check would also apply (mutating or write-sending steps).
  const failFastUnlessRead = (h: HealthWindow): (() => boolean) => {
    const ff = failFast(adapter, h, spec);
    return () => (healthApplies(spec, policy) || wroteData(adapter, h)) && ff();
  };
  const dispatchedUncertain = !!err; // only true here for mutating+dispatched
  verdicts = dispatchedUncertain
    ? []
    : await runVerifiers(post, {
        adapter,
        timeoutMs: timeout,
        sinceIndex,
        ...(health && policy.health !== "off" ? { abort: failFastUnlessRead(health) } : {}),
      });
  if (implicit.length) verdicts = verdicts.map(hideImplicit);
  trace.emit("verdict", {
    id: spec.id,
    verdicts: verdicts.map((v) => ({ type: v.verifier.type, status: v.status, detail: v.detail })),
  });

  if (!dispatchedUncertain) {
    if (post.length === 0)
      return finishChecked("unverified", { note: "no postconditions declared" });
    if (verdicts.every((v) => v.status === "pass")) return finishChecked("verified");
    if (!spec.mutating) {
      const bad = verdicts.find((v) => v.status !== "pass")!;
      return finish("failed", {
        error: {
          code: "other",
          message: `postcondition failed: ${bad.detail}`,
          hint: postconditionHint(spec, bad),
        },
      });
    }
  }

  // 4b. Declared synchronous: an unmet check is a failure, not an unknown outcome (still never repeated:
  // the RepeatGuard keys on the possible effect, not on this label).
  if (spec.synchronous && !dispatchedUncertain && spec.mutating) {
    const bad = verdicts.find((v) => v.status !== "pass");
    if (bad)
      return finish("failed", {
        error: {
          code: "other",
          message: `postcondition failed: ${bad.detail}`,
          hint: postconditionHint(spec, bad),
        },
        note: "step declared synchronous: an unmet check is a failure",
      });
  }

  // 5. Mutating action with failed/unobserved postconditions or possibly-dispatched failure.
  let attemptsLeft = 1;
  for (;;) {
    const failing = verdicts.find((v) => v.status !== "pass");
    const cause: ErrorInfo = err
      ? info(err)
      : {
          code: "other",
          message: `postcondition failed: ${failing?.detail ?? "unobserved"}`,
          hint: failing ? postconditionHint(spec, failing) : undefined,
        };

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
      // The action completed and nothing is in flight: a late effect would need a pending request, so
      // the unmet check is a failure. Still never repeated (RepeatGuard) and clearable by `confirms`
      // if the check itself was wrong.
      if (!err && adapter.pendingRequests?.() === 0) {
        return finish("failed", {
          error: {
            code: "expectation_not_met",
            message: cause.message,
            hint: `the page is idle, so the effect is not still arriving. If the page shows it happened, your check was wrong: do not repeat the action, confirm with a non-mutating step that declares an expectation and sets confirms: "${spec.id}"`,
          },
          note: "page idle: no request in flight; not re-issued",
        });
      }
      return finish("outcome_unknown", {
        error: cause,
        note: "mutating action with unobserved outcome and no reconcile probe; not re-issued",
      });
    }
    const probe = await runVerifier(spec.reconcile, {
      adapter,
      // A server error with nothing in flight leaves little to wait for: one short look is enough.
      timeoutMs: Math.min(
        timeout,
        health && !adapter.pendingRequests?.() && contradictions(adapter, health, spec).length
          ? 300
          : 2000,
      ),
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
    health = healthWindow(adapter);
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
    verdicts = await runVerifiers(post, {
      adapter,
      timeoutMs: timeout,
      sinceIndex: beforeRetry,
      ...(policy.health !== "off" ? { abort: failFastUnlessRead(health) } : {}),
    });
    const ok = verdicts.length > 0 && verdicts.every((v) => v.status === "pass");
    record(
      "retry_transient",
      cause,
      "reconcile showed no effect; action re-issued once safely",
      ok,
    );
    if (ok) return finishChecked("verified");
    err = undefined;
  }
}
