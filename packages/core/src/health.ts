import type { BrowserAdapter } from "./adapter.js";
import type { ActionSpec, Policy } from "./types.js";

/** Where the network/event logs stood when the (final attempt of an) action began. */
export interface HealthWindow {
  net: number;
  events: number;
}

export function healthWindow(adapter: BrowserAdapter): HealthWindow {
  return { net: adapter.networkLog().length, events: adapter.pageEvents?.().length ?? 0 };
}

/** Whether this step is subject to the page-health check under the policy. */
export function healthApplies(spec: ActionSpec, policy: Policy): boolean {
  const mode = policy.health ?? "mutating";
  if (mode === "off") return false;
  return mode === "all" || !!spec.mutating;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url.slice(0, 80);
  }
};

/**
 * Problems the page showed while the action ran, independent of what the author declared:
 *  - any response with status >= 500
 *  - a 4xx response or a failed request on a non-read call (a rejected write)
 *  - an uncaught page exception
 * Endpoints the step explicitly verifies with a network check (or lists in healthIgnore) are exempt:
 * the author already stated what to expect there. Aborted requests (navigation) are not failures.
 */
export function healthFindings(
  adapter: BrowserAdapter,
  from: HealthWindow,
  spec: ActionSpec,
): string[] {
  const exempt = [
    ...(spec.healthIgnore ?? []),
    ...[...(spec.postconditions ?? []), ...(spec.reconcile ? [spec.reconcile] : [])].flatMap((v) =>
      v.type === "network" ? [v.urlPattern] : [],
    ),
  ];
  const skip = (url: string) => exempt.some((e) => url.includes(e));
  const out: string[] = [];
  for (const e of adapter.networkLog().slice(from.net)) {
    if (skip(e.url)) continue;
    const write = !READ_METHODS.has(e.method.toUpperCase());
    if (e.status >= 500 || (write && e.status >= 400))
      out.push(`${e.method.toUpperCase()} ${pathOf(e.url)} returned ${e.status}`);
  }
  for (const ev of adapter.pageEvents?.().slice(from.events) ?? []) {
    if (ev.kind === "pageerror") {
      out.push(`uncaught page error: ${ev.text.slice(0, 120)}`);
    } else if (
      ev.url &&
      !skip(ev.url) &&
      !READ_METHODS.has((ev.method ?? "GET").toUpperCase()) &&
      !/ERR_ABORTED|aborted|blockedbyclient|BLOCKED_BY_CLIENT/i.test(ev.text)
    ) {
      out.push(
        `${(ev.method ?? "").toUpperCase()} ${pathOf(ev.url)} failed: ${ev.text.slice(0, 80)}`,
      );
    }
  }
  return [...new Set(out)].slice(0, 5);
}

/** Writes and failures seen while the step ran, as short lines a model can read ("POST /api/orders 201"). */
export function requestSummary(adapter: BrowserAdapter, from: HealthWindow): string[] {
  const out: string[] = [];
  for (const e of adapter.networkLog().slice(from.net)) {
    const write = !READ_METHODS.has(e.method.toUpperCase());
    if (write || e.status >= 400)
      out.push(`${e.method.toUpperCase()} ${pathOf(e.url)} ${e.status}`);
  }
  return [...new Set(out)].slice(0, 5);
}
