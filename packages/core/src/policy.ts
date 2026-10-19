import path from "node:path";

import type { Policy } from "./types.js";

/** True if `host` equals an allowed domain or is a subdomain of one. */
export function hostAllowed(host: string, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  const h = host.toLowerCase();
  return allowed.some((d) => {
    const dom = d.toLowerCase();
    return h === dom || h.endsWith("." + dom);
  });
}

export function urlAllowed(url: string, policy: Policy): { allowed: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { allowed: false, reason: `invalid URL: ${url}` };
  }
  if (!["http:", "https:", "about:", "data:"].includes(u.protocol)) {
    return { allowed: false, reason: `scheme not allowed: ${u.protocol}` };
  }
  if (u.protocol === "about:") return { allowed: true };
  if (u.protocol === "data:") {
    return policy.allowedDomains?.length
      ? { allowed: false, reason: "data: URLs are blocked when allowedDomains is set" }
      : { allowed: true };
  }
  if (!hostAllowed(u.hostname, policy.allowedDomains)) {
    return { allowed: false, reason: `host not in allowedDomains: ${u.hostname}` };
  }
  return { allowed: true };
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /(password|passwd|secret|token|api[_-]?key)(["']?\s*[:=]\s*["']?)([^\s"',}]{4,})/gi,
];

/** Replaces likely secrets and any explicitly configured secret values. */
export function redact(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s.length >= 4) out = out.split(s).join("[REDACTED]");
  }
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (...m) => {
      const groups = m.slice(1, -2) as string[];
      return groups.length >= 3 ? `${groups[0]}${groups[1]}[REDACTED]` : "[REDACTED]";
    });
  }
  return out;
}

/** Deep-redacts all strings in a JSON-like value. */
export function redactDeep<T>(value: T, secrets: string[] = []): T {
  if (typeof value === "string") return redact(value, secrets) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, secrets);
    }
    return out as T;
  }
  return value;
}

/** Resolves `candidate` under `root`; throws if it escapes (path traversal). */
export function resolveInside(root: string, candidate: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, candidate);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`path escapes root: ${candidate}`);
  }
  return full;
}
