import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PlaywrightAdapter } from "@vedha/adapter-playwright";
import {
  NEVER_PROBE,
  REFUSED_HINT,
  RepeatGuard,
  Session,
  redact,
  createBundle,
  proposalFromSession,
  promote,
  renderFeedback,
  resolveInside,
  writeBundle,
} from "@vedha/core";
import type { ActionSpec, ObservationLevel, Target, Verifier } from "@vedha/core";
import type { McpConfig } from "./config.js";

const MAX_TEXT = 12_000;

/** Flat, model-friendly target: exactly one way of finding the element, plus an optional iframe. */
export const targetInput = z
  .object({
    role: z.string().optional().describe("ARIA role, e.g. button"),
    name: z.string().optional().describe("accessible name (with role)"),
    label: z.string().optional(),
    text: z.string().optional(),
    test_id: z.string().optional(),
    ref: z.string().optional().describe("ref from the latest observation"),
    frame: z.string().optional().describe("CSS selector of the containing iframe"),
    exact: z.boolean().optional().describe("exact match (default true)"),
  })
  .describe("ONE of: role(+name), label, text, test_id, ref");
/** Shorter form for secondary targets (drag destination, expectations). */
const targetLite = z
  .object({
    role: z.string().optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    text: z.string().optional(),
  })
  .describe("role(+name), label or text");
type TargetInput = z.infer<typeof targetInput>;

/**
 * Several selectors at once (models often send ref and role together) resolve by durability: test id, role,
 * label, text, and the ref last because refs expire when the page re-renders. Nothing at all is an error.
 */
export function toTarget(t: TargetInput): Target {
  const exact = t.exact ?? true;
  const base: Target | undefined = t.test_id
    ? { testId: t.test_id }
    : t.role
      ? { role: t.role, ...(t.name !== undefined ? { name: t.name } : {}), exact }
      : t.label
        ? { label: t.label, exact }
        : t.text
          ? { text: t.text, exact }
          : t.ref
            ? { ref: t.ref }
            : undefined;
  if (!base) throw new Error("a target needs one of: role (with name), label, text, test_id, ref");
  return t.frame ? { inFrame: t.frame, target: base } : base;
}

/** Ops that act on the page as a whole: a stray or empty target is ignored instead of failing the call. */
/** Ops whose effect Vedha reports on a line of its own when no check was declared. */
const EFFECT_OPS = new Set([
  "click",
  "dblclick",
  "fill",
  "select",
  "check",
  "uncheck",
  "press",
  "upload",
  "drag",
]);

const PAGE_OPS = new Set(["goto", "scroll", "wait", "back", "reload", "press", "switch_tab"]);

function targetFor(op: string, t: TargetInput | undefined): Target | undefined {
  if (!t) return undefined;
  try {
    return toTarget(t);
  } catch (e) {
    if (PAGE_OPS.has(op)) return undefined;
    throw e;
  }
}

export const expectInput = z
  .object({
    text_contains: z.string().optional(),
    url_contains: z.string().optional(),
    visible: targetLite.optional(),
    hidden: targetLite.optional(),
    request: z
      .object({
        method: z.string().optional(),
        url_contains: z.string(),
        status_2xx: z.boolean().optional(),
      })
      .optional()
      .describe("a request this action must send, and that it succeeds"),
  })
  .describe("Checks Vedha runs itself afterwards: declare what success looks like");

export const actInput = {
  op: z.enum([
    "goto",
    "click",
    "dblclick",
    "hover",
    "fill",
    "select",
    "check",
    "uncheck",
    "press",
    "upload",
    "scroll",
    "drag",
    "wait",
    "back",
    "reload",
    "switch_tab",
  ]),
  intent: z.string().min(1).max(200).describe("what this step is for"),
  target: targetInput.optional(),
  to: targetLite.optional().describe("drag destination"),
  value: z
    .string()
    .optional()
    .describe("url | text | option label | key | file path | scroll direction | tab index"),
  mutating: z
    .boolean()
    .optional()
    .describe(
      "true if it changes data (submit, delete, pay); never repeated after an unknown outcome",
    ),
  destructive: z
    .boolean()
    .optional()
    .describe("irreversible; blocked unless the operator allows it"),
  expect: expectInput.optional(),
  reconcile: z
    .object({ get: z.string().startsWith("/"), matches: z.record(z.string(), z.unknown()) })
    .optional()
    .describe(
      "read-only GET returning JSON with an item matching `matches` iff the effect happened",
    ),
  synchronous: z
    .boolean()
    .optional()
    .describe(
      "effect is immediate (client-side): an unmet expectation is then a failure, not unknown",
    ),
  enabling: z
    .boolean()
    .optional()
    .describe(
      "only makes a later step possible; hover, scroll, wait, switch_tab, back, reload default true",
    ),
  confirms: z
    .string()
    .optional()
    .describe(
      "id of an earlier unresolved step; if this step verifies (use wait with an expect) its effect is confirmed",
    ),
  repeat: z
    .boolean()
    .optional()
    .describe("deliberately repeat a mutating action whose outcome was unknown"),
};

function verifiersOf(e: z.infer<typeof expectInput> | undefined): Verifier[] {
  if (!e) return [];
  const v: Verifier[] = [];
  if (e.text_contains) v.push({ type: "text", contains: e.text_contains });
  if (e.url_contains) v.push({ type: "url", matches: e.url_contains });
  if (e.visible) v.push({ type: "state", target: toTarget(e.visible), state: "visible" });
  if (e.hidden) v.push({ type: "state", target: toTarget(e.hidden), state: "hidden" });
  if (e.request)
    v.push({
      type: "network",
      method: e.request.method,
      urlPattern: e.request.url_contains,
      status: e.request.status_2xx === false ? undefined : "2xx",
    });
  return v;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Every tool result passes through redaction, as Playwright MCP's does (response.ts:225). */
function makeText(secrets: string[] | undefined) {
  return (t: string, isError = false): ToolResult => {
    const safe = redact(t, secrets ?? []);
    return {
      content: [
        {
          type: "text",
          text: safe.length > MAX_TEXT ? safe.slice(0, MAX_TEXT) + "\n[truncated]" : safe,
        },
      ],
      ...(isError ? { isError: true } : {}),
    };
  };
}

/** One browser session behind the MCP tools, created on first use. */
export class VedhaTools {
  private session?: Session;
  private n = 0;
  /** Mutating actions whose effect is unknown: repeating them needs an explicit `repeat: true`. */
  private readonly guard = new RepeatGuard();
  private steps = 0;
  private consecutiveFailures = 0;

  private readonly text: ReturnType<typeof makeText>;

  constructor(private readonly config: McpConfig) {
    this.text = makeText(config.policy.secrets);
  }

  private async ensure(): Promise<Session> {
    if (this.session) return this.session;
    const adapter = await PlaywrightAdapter.launch({
      browser: this.config.browser,
      headless: !this.config.headed,
    });
    this.session = await Session.create(adapter, this.config.policy);
    return this.session;
  }

  async act(a: {
    op: ActionSpec["op"];
    intent: string;
    target?: TargetInput;
    to?: TargetInput;
    value?: string;
    mutating?: boolean;
    destructive?: boolean;
    expect?: z.infer<typeof expectInput>;
    reconcile?: { get: string; matches: Record<string, unknown> };
    confirms?: string;
    enabling?: boolean;
    synchronous?: boolean;
    repeat?: boolean;
  }): Promise<ToolResult> {
    let spec: ActionSpec;
    try {
      spec = {
        id: `step-${++this.n}`,
        intent: a.intent,
        op: a.op,
        target: targetFor(a.op, a.target),
        to: targetFor(a.op, a.to),
        value: a.value,
        mutating: a.mutating,
        destructive: a.destructive,
        confirms: a.confirms,
        enabling: a.enabling,
        synchronous: a.synchronous,
        postconditions: verifiersOf(a.expect),
        reconcile: a.reconcile
          ? { type: "api", get: a.reconcile.get, matchesAny: a.reconcile.matches }
          : undefined,
      };
    } catch (e) {
      return this.text(`invalid action: ${(e as Error).message}`, true);
    }
    const session = await this.ensure();
    const refusal = a.repeat ? undefined : this.guard.refuses(spec);
    const r = refusal ? session.reject(spec, refusal, REFUSED_HINT) : await session.step(spec);
    if (!refusal) {
      this.guard.record(spec, r);
      if (spec.confirms && session.results.find((x) => x.actionId === spec.confirms)?.confirmedBy)
        this.guard.resolve(spec.confirms);
    }
    const obs = await session.observe({ level: "outline", delta: true });
    this.steps++;
    this.consecutiveFailures =
      r.status === "verified" || r.status === "unverified" ? 0 : this.consecutiveFailures + 1;
    const counters =
      this.consecutiveFailures >= 3
        ? `\nWARNING: ${this.consecutiveFailures} steps in a row did not verify (${this.steps} steps used). If the task cannot be completed, stop and report what you found, including whether it took effect.`
        : "";
    return this.text(
      renderFeedback(r, obs, { changes: true, effect: EFFECT_OPS.has(a.op) }) + counters,
      r.status === "failed" || r.status === "blocked",
    );
  }

  async observe(level: ObservationLevel = "outline", ref?: string): Promise<ToolResult> {
    const session = await this.ensure();
    try {
      const obs = await session.observe({ level, ref });
      return this.text(renderFeedback(undefined, obs));
    } catch (e) {
      if (!ref) throw e;
      // A ref from before a navigation or re-render no longer exists: show the current page instead of an error.
      const obs = await session.observe({ level: "outline" });
      return this.text(
        `ref ${ref} is no longer on the page (it changed since that observation); current page:\n${renderFeedback(undefined, obs)}`,
      );
    }
  }

  /** Read-only GET of a same-origin JSON path, so state can be checked without navigating away from the page. */
  async probe(pathname: string): Promise<ToolResult> {
    const session = await this.ensure();
    if (!pathname.startsWith("/") || NEVER_PROBE.test(pathname))
      return this.text(
        `probe refused: use a same-origin path such as /api/items (not ${pathname})`,
        true,
      );
    try {
      const res = await session.adapter.fetchJson(pathname);
      const body = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
      return this.text(`GET ${pathname} -> ${res.status}\n${body.slice(0, 3000)}`);
    } catch (e) {
      return this.text(`probe failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  async report(): Promise<ToolResult> {
    const session = await this.ensure();
    const rep = session.report();
    return this.text(
      JSON.stringify(
        {
          verdict: rep.verdict,
          steps: rep.steps.map((s) => ({
            id: s.actionId,
            status: s.status,
            recovered: s.recovered,
            error: s.error,
            recoveries: s.recoveries.map((r) => `${r.strategy}:${r.outcome}`),
            observed: s.observed,
          })),
        },
        null,
        2,
      ),
    );
  }

  async promoteTest(title: string, goal: string, file?: string): Promise<ToolResult> {
    const session = await this.ensure();
    const proposal = proposalFromSession(session, { title, goal });
    const code = promote(proposal, { baseUrl: session.startUrl });
    let saved = "";
    if (file) {
      if (!this.config.outDir)
        return this.text("writing files is disabled: start vedha-mcp with --out DIR", true);
      fs.mkdirSync(this.config.outDir, { recursive: true });
      const dest = resolveInside(path.resolve(this.config.outDir), file);
      fs.writeFileSync(dest, code);
      saved = `\nsaved: ${dest}`;
    }
    return this.text(
      `confidence ${proposal.confidence}; assumptions:\n${proposal.assumptions.map((x) => `- ${x}`).join("\n") || "- none"}${saved}\n\n${code}`,
    );
  }

  async bundle(goal: string): Promise<ToolResult> {
    if (!this.config.outDir)
      return this.text("writing files is disabled: start vedha-mcp with --out DIR", true);
    const session = await this.ensure();
    const bundle = createBundle(session, goal);
    const dir = await writeBundle(
      path.resolve(this.config.outDir, `bundle-${Date.now()}`),
      bundle,
      await session.adapter.screenshot(),
    );
    return this.text(`failure bundle written to ${dir}`);
  }

  async close(): Promise<void> {
    await this.session?.close();
    this.session = undefined;
  }
}
