import type { BrowserAdapter } from "./adapter.js";
import { healthFindings } from "./health.js";
import type { HealthWindow } from "./health.js";
import type { ActionSpec } from "./types.js";

/** The network must stay idle this long after a failure before waiting is given up (an app-level retry would show by then). */
const QUIET_MS = 150;

/**
 * Health findings for a step, counting a failure on an endpoint with a declared 2xx network check: that check
 * expects success, so a 500 there is the contradiction itself and not an "expected" error to exempt.
 */
export function contradictions(
  adapter: BrowserAdapter,
  from: HealthWindow,
  spec: ActionSpec,
): string[] {
  const probe: ActionSpec = {
    ...spec,
    postconditions: (spec.postconditions ?? []).filter((v) => {
      if (v.type !== "network") return true;
      const st = v.status;
      return !(st === undefined || st === "2xx" || (st >= 200 && st < 300));
    }),
  };
  return healthFindings(adapter, from, probe);
}

/**
 * Evidence-aware waiting: once the step has produced a 5xx, a rejected write or an uncaught page error and the
 * network has been idle for QUIET_MS, no declared check can still become true for a good reason, so waiting out
 * the full timeout only delays the verdict. The final health check then reports the cause.
 */
export function failFast(
  adapter: BrowserAdapter,
  from: HealthWindow,
  spec: ActionSpec,
): () => boolean {
  let quietSince: number | undefined;
  return () => {
    if (adapter.pendingRequests?.() !== 0 || contradictions(adapter, from, spec).length === 0) {
      quietSince = undefined;
      return false;
    }
    quietSince ??= Date.now();
    return Date.now() - quietSince >= QUIET_MS;
  };
}
