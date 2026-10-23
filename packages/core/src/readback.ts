import type { BrowserAdapter } from "./adapter.js";
import type { HealthWindow } from "./health.js";
import { sleep } from "./verifiers.js";
import type { ActionSpec, NetworkEntry, Policy } from "./types.js";

export interface ReadBack {
  /** Short lines for what a read-back confirmed. */
  confirmed: string[];
  /** Structured form of each confirmation, so promotion can turn it into an assertion (writes with fields only). */
  probes: Array<{ get: string; matchesAny: Record<string, unknown> }>;
  /** Set when a read-back answered but the written item is not there. */
  contradiction?: string;
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_ITEMS = 100;
const SETTLE_MS = 1200;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const pathOf = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

/** Items of a collection response: the array itself, or the first array property, else the object. */
function itemsOf(body: unknown): Json[] | undefined {
  if (Array.isArray(body)) return body.filter(isObj);
  if (isObj(body)) {
    const arr = Object.values(body).find((v) => Array.isArray(v));
    if (arr) return (arr as unknown[]).filter(isObj);
    return [body];
  }
  return undefined;
}

function primitives(o: unknown): Array<[string, string | number | boolean]> {
  if (!isObj(o)) return [];
  return Object.entries(o).filter(
    (e): e is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof e[1]) && String(e[1]).length <= 200,
  );
}

const idOf = (o: unknown): string | undefined => {
  if (!isObj(o)) return undefined;
  const v = o.id ?? o._id ?? o.uuid;
  return v === undefined || v === null ? undefined : String(v);
};

function hasId(items: Json[], id: string): boolean {
  return items.some((it) => idOf(it) === id);
}

function matchesSubset(item: Json, fields: Array<[string, unknown]>): boolean {
  return fields.every(([k, v]) => item[k] === v || String(item[k]) === String(v));
}

/** Where to read a write back, and what to expect there. Undefined when there is no sound convention. */
function plan(
  e: NetworkEntry,
):
  | { probe: string; check: (items: Json[]) => "ok" | "missing" | "unclear"; what: string }
  | undefined {
  const method = e.method.toUpperCase();
  const path = pathOf(e.url).split("?")[0]!;
  if (method === "POST") {
    const id = idOf(e.json);
    const fields = primitives(e.requestJson);
    if (!id && !fields.length) return undefined;
    return {
      probe: path,
      what: `${method} ${path}`,
      check: (items) => {
        if (id) return hasId(items, id) ? "ok" : "missing";
        if (items.some((it) => matchesSubset(it, fields))) return "ok";
        // Non-empty list whose items share no key with what was sent: different schema, no claim.
        if (items.length && !items.some((it) => fields.some(([k]) => k in it))) return "unclear";
        return "missing";
      },
    };
  }
  if (method === "PUT" || method === "PATCH") {
    const fields = primitives(e.requestJson);
    if (!fields.length) return undefined;
    return {
      probe: path,
      what: `${method} ${path}`,
      check: (items) => {
        const one = items[0];
        if (!one || !fields.some(([k]) => k in one)) return "unclear";
        return matchesSubset(one, fields) ? "ok" : "missing";
      },
    };
  }
  if (method === "DELETE") {
    const segs = path.split("/").filter(Boolean);
    const id = segs.at(-1);
    if (!id || segs.length < 2) return undefined;
    const parent = "/" + segs.slice(0, -1).join("/");
    return {
      probe: parent,
      what: `${method} ${path}`,
      check: (items) => {
        if (!items.some((it) => idOf(it) !== undefined)) return "unclear";
        return hasId(items, id) ? "missing" : "ok";
      },
    };
  }
  return undefined;
}

/**
 * Convention-based read-back after writes that returned 2xx: POST /x then GET /x lists the item,
 * PUT/PATCH then GET shows the fields, DELETE /x/1 then GET /x no longer lists id 1. Silent when the
 * convention does not hold (GET unsupported, non-JSON, other schema, large or paginated lists), so only
 * a collection that answers and clearly lacks the item counts as a contradiction. Read-only GETs through
 * the adapter, same session, policy-checked.
 */
export async function readBack(
  adapter: BrowserAdapter,
  from: HealthWindow,
  spec: ActionSpec,
  policy: Policy,
): Promise<ReadBack> {
  const out: ReadBack = { confirmed: [], probes: [] };
  if (policy.readback === "off") return out;
  // Exempt: explicit healthIgnore, endpoints where the author expects a non-2xx answer, and endpoints the
  // author probes for state themselves (a declared api postcondition). A declared 2xx network check does
  // NOT exempt: it validates the response, not that the data was kept. A reconcile probe does not exempt
  // either: it only runs on unknown outcomes, so it never checked a step that looked fine.
  const exempt = [
    ...(spec.healthIgnore ?? []),
    ...(spec.postconditions ?? []).flatMap((v) => {
      if (v.type === "api") return [v.get];
      if (v.type !== "network") return [];
      const st = v.status;
      const expects2xx = st === undefined || st === "2xx" || (st >= 200 && st < 300);
      return expects2xx ? [] : [v.urlPattern];
    }),
  ];
  const seen = new Set<string>();
  for (const e of adapter.networkLog().slice(from.net)) {
    if (!WRITES.has(e.method.toUpperCase()) || e.status < 200 || e.status >= 300) continue;
    if (exempt.some((x) => e.url.includes(x))) continue;
    const p = plan(e);
    if (!p || seen.has(p.what)) continue;
    seen.add(p.what);
    const deadline = Date.now() + SETTLE_MS;
    let verdict: "ok" | "missing" | "unclear" = "unclear";
    let answered = false;
    for (;;) {
      let res: { status: number; body: unknown };
      try {
        res = await adapter.fetchJson(p.probe);
      } catch {
        break;
      }
      if (res.status < 200 || res.status >= 300) break;
      const items = itemsOf(res.body);
      if (!items || items.length >= MAX_ITEMS) break;
      answered = true;
      verdict = p.check(items);
      if (verdict !== "missing" || Date.now() >= deadline) break;
      await sleep(150); // eventual consistency: give the item a moment to appear
    }
    if (!answered) continue;
    if (verdict === "ok") {
      out.confirmed.push(`read-back ${p.probe} confirms ${p.what}`);
      const fields = ["POST", "PUT", "PATCH"].includes(e.method.toUpperCase())
        ? Object.fromEntries(primitives(e.requestJson))
        : {};
      if (Object.keys(fields).length) out.probes.push({ get: p.probe, matchesAny: fields });
    } else if (verdict === "missing") {
      out.contradiction = `${p.what} returned 2xx but reading ${p.probe} back does not show the written item`;
      return out;
    }
  }
  return out;
}
