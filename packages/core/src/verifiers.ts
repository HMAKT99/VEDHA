import type { BrowserAdapter } from "./adapter.js";
import { AdapterError } from "./adapter.js";
import type { NetworkEntry, Verdict, Verifier } from "./types.js";

/** "/pattern/" is a regex literal; a bare "/" or "/items" is a plain substring. */
export function isRegexLiteral(s: string): boolean {
  return s.length >= 3 && s.startsWith("/") && s.endsWith("/");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls `fn` until it returns a non-undefined value or the deadline passes. The first check is
 * immediate; waits then grow 4, 6, 9, 14 ... ms up to `intervalMs`, so a result that lands a few
 * milliseconds after the action is noticed promptly instead of up to a fixed interval late, while a long
 * wait still settles at `intervalMs` (cheap for in-memory checks, bounded RPC rate for browser checks).
 */
export async function pollUntil<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs = 50,
  abort?: () => boolean,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  let wait = Math.min(4, intervalMs);
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() >= deadline || abort?.()) return undefined;
    await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
    wait = Math.min(intervalMs, Math.ceil(wait * 1.5));
  }
}

/**
 * Like `pollUntil`, but a match only counts if a second read (after `stableMs`, which may be 0) still
 * sees it: some apps render the expected state and then re-render it away (seen on TodoMVC filters), and
 * a check must not pass on that flash. A match that does not hold sends polling on until the deadline.
 */
export async function pollStable<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs: number,
  stableMs: number,
  intervalMs = 50,
  abort?: () => boolean,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await pollUntil(fn, Math.max(0, deadline - Date.now()), intervalMs, abort);
    if (v === undefined) return v;
    if (stableMs > 0) await sleep(stableMs);
    const again = await fn();
    if (again !== undefined) return again;
    if (Date.now() >= deadline || abort?.()) return undefined;
  }
}

/**
 * Extra wait before the confirming read of a DOM text/value match (see `pollStable`). 0: the browser
 * round trip of the second read was enough (M2 flash false passes 9/320 -> 0/320) at 1.07x overhead,
 * where a 30 ms wait cost 1.52x.
 */
export const STABLE_MS = 0;

/** Minimal dotted/indexed JSON path: `a.b[0].c`. Returns undefined when absent. */
export function jsonPath(value: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = value;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function statusMatches(expected: number | "2xx" | undefined, actual: number): boolean {
  if (expected === undefined) return true;
  if (expected === "2xx") return actual >= 200 && actual < 300;
  return actual === expected;
}

export function matchesFields(item: unknown, fields: Record<string, unknown>): boolean {
  if (item === null || typeof item !== "object") return false;
  const rec = item as Record<string, unknown>;
  return Object.entries(fields).every(([k, v]) => rec[k] === v);
}

export interface VerifyContext {
  adapter: BrowserAdapter;
  timeoutMs: number;
  /** Only network entries at index >= sinceIndex are considered. */
  sinceIndex: number;
  /** Checked between polls: true means a definitive contradiction is already visible, stop waiting. */
  abort?: () => boolean;
}

export async function runVerifier(v: Verifier, ctx: VerifyContext): Promise<Verdict> {
  const { adapter, timeoutMs } = ctx;
  try {
    switch (v.type) {
      case "url": {
        const re = isRegexLiteral(v.matches) ? new RegExp(v.matches.slice(1, -1)) : undefined;
        let last = "";
        const ok = await pollUntil(
          async () => {
            last = await adapter.currentUrl();
            return (re ? re.test(last) : last.includes(v.matches)) ? true : undefined;
          },
          timeoutMs,
          50,
          ctx.abort,
        );
        return ok
          ? { verifier: v, status: "pass", detail: `url ${last} matches ${v.matches}` }
          : { verifier: v, status: "fail", detail: `url ${last} does not match ${v.matches}` };
      }
      case "text": {
        let last: string | null = null;
        const ok = await pollStable(
          async () => {
            last = await adapter.text(v.target, Math.min(500, timeoutMs));
            if (last === null) return undefined;
            if (v.equals !== undefined) return last.trim() === v.equals ? true : undefined;
            if (v.contains !== undefined) return last.includes(v.contains) ? true : undefined;
            return true;
          },
          timeoutMs,
          STABLE_MS,
          50,
          ctx.abort,
        );
        const want = v.equals ?? v.contains ?? "(any)";
        return ok
          ? { verifier: v, status: "pass", detail: `text matched ${JSON.stringify(want)}` }
          : {
              verifier: v,
              status: "fail",
              detail:
                last === null
                  ? "target not found"
                  : `text ${JSON.stringify(String(last).slice(0, 120))} did not match ${JSON.stringify(want)}`,
            };
      }
      case "value": {
        let last: string | null = null;
        const ok = await pollStable(
          async () => {
            last = await adapter.value(v.target, Math.min(500, timeoutMs));
            return last === v.equals ? true : undefined;
          },
          timeoutMs,
          STABLE_MS,
          50,
          ctx.abort,
        );
        return ok
          ? { verifier: v, status: "pass", detail: `value equals ${JSON.stringify(v.equals)}` }
          : {
              verifier: v,
              status: "fail",
              detail:
                last === null
                  ? "target not found"
                  : `value ${JSON.stringify(last)} != ${JSON.stringify(v.equals)}`,
            };
      }
      case "state": {
        const ok = await adapter.elementState(v.target, v.state, timeoutMs);
        return ok
          ? { verifier: v, status: "pass", detail: `element is ${v.state}` }
          : { verifier: v, status: "fail", detail: `element did not become ${v.state}` };
      }
      case "network": {
        let detail = "no matching response observed";
        let contradiction = false;
        let observedStatus: number | undefined;
        const hit = await pollUntil(
          async () => {
            const entries = adapter.networkLog().slice(ctx.sinceIndex);
            const candidates = entries.filter(
              (e: NetworkEntry) =>
                (!v.method || e.method.toUpperCase() === v.method.toUpperCase()) &&
                e.url.includes(v.urlPattern),
            );
            if (candidates.length === 0) return undefined;
            const statusOk = candidates.filter((e) => statusMatches(v.status, e.status));
            if (statusOk.length === 0) {
              const last = candidates[candidates.length - 1]!;
              detail = `response ${last.method} ${last.url} had status ${last.status}, expected ${String(v.status)}`;
              contradiction = true;
              observedStatus = last.status;
              return { mismatch: true } as unknown as NetworkEntry;
            }
            if (!v.json) return statusOk[statusOk.length - 1]!;
            const withJson = statusOk.find((e) => e.json !== undefined);
            if (!withJson) {
              detail = "matching response had no JSON body yet";
              return undefined;
            }
            const actual = jsonPath(withJson.json, v.json.path);
            if (actual === v.json.equals) return withJson;
            contradiction = true;
            observedStatus = withJson.status;
            detail = `json ${v.json.path} was ${JSON.stringify(actual)}, expected ${JSON.stringify(v.json.equals)}`;
            // A definitive mismatch will not change; fail fast.
            return { mismatch: true } as unknown as NetworkEntry;
          },
          timeoutMs,
          8,
        );
        if (hit && !("mismatch" in (hit as object))) {
          return {
            verifier: v,
            status: "pass",
            detail: `matched ${v.method ?? "*"} ${v.urlPattern}`,
          };
        }
        return { verifier: v, status: "fail", detail, definitive: contradiction, observedStatus };
      }
      case "api": {
        let detail = "no matching item";
        // The probe itself answered 2xx but the effect was never there: a contradiction, not an unknown.
        let answered = false;
        const ok = await pollUntil(
          async () => {
            const res = await adapter.fetchJson(v.get);
            if (res.status < 200 || res.status >= 300) {
              detail = `GET ${v.get} returned ${res.status}`;
              return undefined;
            }
            answered = true;
            const items = Array.isArray(res.body) ? res.body : [res.body];
            if (items.some((it) => matchesFields(it, v.matchesAny))) return true;
            detail = `no item in GET ${v.get} matched ${JSON.stringify(v.matchesAny)} (${items.length} items)`;
            return undefined;
          },
          timeoutMs,
          50,
          ctx.abort,
        );
        return ok
          ? { verifier: v, status: "pass", detail: `GET ${v.get} contains matching item` }
          : { verifier: v, status: "fail", detail, definitive: answered };
      }
    }
  } catch (e) {
    if (e instanceof AdapterError && e.code === "policy_blocked") {
      return { verifier: v, status: "unverifiable", detail: e.message };
    }
    return {
      verifier: v,
      status: "unverifiable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runVerifiers(vs: Verifier[], ctx: VerifyContext): Promise<Verdict[]> {
  const out: Verdict[] = [];
  for (const v of vs) out.push(await runVerifier(v, ctx));
  return out;
}
