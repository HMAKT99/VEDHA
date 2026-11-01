/**
 * Guard mode: watches an ordinary Playwright test (no Vedha steps needed) and reports what the page's
 * own assertions cannot see: server errors and rejected or failed writes behind a page that looked fine.
 * Same rules as Vedha's page-health check (core/src/health.ts), applied to the whole test.
 */

/** What a finding does to the test: fail it, or only annotate it. */
export type GuardLevel = "fail" | "warn";

export interface GuardOptions {
  /** URL substrings or patterns to ignore (expected errors, endpoints the test checks itself). */
  ignore?: Array<string | RegExp>;
  /** Hosts to treat as the app's own besides the page's site (an API on another domain). */
  hosts?: string[];
  /** A 4xx answer to a POST/PUT/PATCH/DELETE. Default "warn": validation tests often expect one. */
  rejectedWrites?: GuardLevel;
  /** An uncaught exception in the page. Default "warn": third-party scripts throw too. */
  pageErrors?: GuardLevel;
}

/** `true` (default rules), `false` (off), "strict" (every finding fails the test) or custom options. */
export type GuardSetting = boolean | "strict" | GuardOptions;

export interface GuardFinding {
  level: GuardLevel;
  message: string;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ABORTED =
  /ERR_ABORTED|aborted|blockedbyclient|BLOCKED_BY_CLIENT|NS_BINDING_ABORTED|cancelled/i;

export function resolveGuard(s: GuardSetting): Required<GuardOptions> | undefined {
  if (s === false) return undefined;
  const base: Required<GuardOptions> = {
    ignore: [],
    hosts: [],
    rejectedWrites: "warn",
    pageErrors: "warn",
  };
  if (s === true) return base;
  if (s === "strict") return { ...base, rejectedWrites: "fail", pageErrors: "fail" };
  return { ...base, ...s };
}

/** The registrable part of a host, roughly: "api.shop.example.com" -> "example.com"; IPs and localhost as is. */
export function siteOf(host: string): string {
  if (/^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) return host;
  return host.split(".").slice(-2).join(".");
}

function urlParts(url: string): { host: string; path: string } | undefined {
  try {
    const u = new URL(url);
    return { host: u.hostname, path: u.pathname };
  } catch {
    return undefined;
  }
}

/** Is this request the app's own (same site as the page, or a listed host) and not ignored? */
export function watched(
  url: string,
  pageUrl: string | undefined,
  o: Required<GuardOptions>,
): boolean {
  if (o.ignore.some((i) => (typeof i === "string" ? url.includes(i) : i.test(url)))) return false;
  const req = urlParts(url);
  if (!req || !/^https?:/.test(url)) return false;
  if (o.hosts.includes(req.host)) return true;
  const page = pageUrl ? urlParts(pageUrl) : undefined;
  return !!page && siteOf(page.host) === siteOf(req.host);
}

/** A finished response: 5xx always fails; a 4xx on a write follows `rejectedWrites`. */
export function responseFinding(
  method: string,
  url: string,
  status: number,
  o: Required<GuardOptions>,
): GuardFinding | undefined {
  const m = method.toUpperCase();
  const path = urlParts(url)?.path ?? url.slice(0, 80);
  if (status >= 500) return { level: "fail", message: `${m} ${path} returned ${status}` };
  if (status >= 400 && !READ_METHODS.has(m))
    return { level: o.rejectedWrites, message: `${m} ${path} returned ${status}` };
  return undefined;
}

/** A request that never got an answer: a failed write fails the test; reads and aborts are ignored. */
export function failedRequestFinding(
  method: string,
  url: string,
  errorText: string,
): GuardFinding | undefined {
  const m = method.toUpperCase();
  if (READ_METHODS.has(m) || ABORTED.test(errorText)) return undefined;
  const path = urlParts(url)?.path ?? url.slice(0, 80);
  return { level: "fail", message: `${m} ${path} failed: ${errorText.slice(0, 80)}` };
}

export function pageErrorFinding(text: string, o: Required<GuardOptions>): GuardFinding {
  return { level: o.pageErrors, message: `uncaught page error: ${text.slice(0, 120)}` };
}

/** The error a guarded test fails with: what happened, and how to accept it if it was expected. */
export function guardError(fails: GuardFinding[]): Error {
  const lines = [...new Set(fails.map((f) => f.message))].slice(0, 5);
  return new Error(
    [
      "Vedha guard: the test's own checks passed, but the app reported a problem:",
      ...lines.map((l) => `  - ${l}`),
      "If this is expected, add the URL to `vedhaGuard: { ignore: [...] }` or set `vedhaGuard: false` for this test.",
    ].join("\n"),
  );
}
