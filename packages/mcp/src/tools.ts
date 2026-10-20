import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PlaywrightAdapter } from "@vedha/adapter-playwright";
import {
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
    role: z.string().optional().describe("ARIA role, e.g. button, textbox, link, combobox"),
    name: z.string().optional().describe("accessible name; use with role"),
    label: z.string().optional().describe("form field label"),
    text: z.string().optional().describe("visible text"),
    test_id: z.string().optional().describe("data-testid value"),
    ref: z.string().optional().describe("ref from the latest observation, e.g. e5"),
    frame: z.string().optional().describe("CSS selector of the iframe that contains the element"),
    exact: z.boolean().optional().describe("exact match for name/label/text (default true)"),
  })
  .describe("Pick ONE of: role(+name), label, text, test_id, ref");
type TargetInput = z.infer<typeof targetInput>;

export function toTarget(t: TargetInput): Target {
  const exact = t.exact ?? true;
  const found: Target[] = [];
  if (t.role)
    found.push({ role: t.role, ...(t.name !== undefined ? { name: t.name } : {}), exact });
  if (t.label) found.push({ label: t.label, exact });
  if (t.text) found.push({ text: t.text, exact });
  if (t.test_id) found.push({ testId: t.test_id });
  if (t.ref) found.push({ ref: t.ref });
  if (found.length !== 1)
    throw new Error("a target needs exactly one of: role (with name), label, text, test_id, ref");
  const base = found[0]!;
  return t.frame ? { inFrame: t.frame, target: base } : base;
}

export const expectInput = z
  .object({
    text_contains: z.string().optional().describe("text that must appear on the page"),
    url_contains: z.string().optional().describe("the page URL must contain this"),
    visible: targetInput.optional().describe("element that must become visible"),
    hidden: targetInput.optional().describe("element that must become hidden"),
    request: z
      .object({
        method: z.string().optional(),
        url_contains: z.string(),
        status_2xx: z.boolean().optional(),
      })
      .optional()
      .describe("a network request this action must trigger, and that it succeeds"),
  })
  .describe("Checks Vedha runs itself after the action. Declare what success looks like.");

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
  intent: z.string().min(1).max(200).describe("what this step is for, in a few words"),
  target: targetInput.optional(),
  to: targetInput.optional().describe("destination for drag"),
  value: z
    .string()
    .optional()
    .describe(
      "url for goto; text for fill; option label for select; key for press; file path for upload; down|up|top|bottom for scroll; first|last|index for switch_tab",
    ),
  mutating: z
    .boolean()
    .optional()
    .describe(
      "true for actions that change data (submit, delete, pay). Vedha will not repeat them if the outcome is unknown.",
    ),
  destructive: z
    .boolean()
    .optional()
    .describe("true for irreversible actions; blocked unless the operator allowed them"),
  expect: expectInput.optional(),
  reconcile: z
    .object({ get: z.string().startsWith("/"), matches: z.record(z.string(), z.unknown()) })
    .optional()
    .describe(
      "read-only GET (path) that returns JSON containing an item matching `matches` iff the effect happened; lets Vedha confirm a mutating action without repeating it",
    ),
  synchronous: z
    .boolean()
    .optional()
    .describe(
      "true if this action's effect is immediate (client-side). Then an unmet expectation is a failure instead of an unknown outcome.",
    ),
  enabling: z
    .boolean()
    .optional()
    .describe(
      "true if this step only makes a later step possible (open a menu, reveal an item). hover, scroll, wait, switch_tab, back and reload default to true.",
    ),
  confirms: z
    .string()
    .optional()
    .describe(
      "id of an earlier step whose outcome was unknown (for example step-3). If this step verifies, that effect counts as confirmed. Use a non-mutating op such as wait, with an expect.",
    ),
  repeat: z
    .boolean()
    .optional()
    .describe(
      "set true only to deliberately repeat a mutating action whose earlier outcome was unknown",
    ),
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
        target: a.target ? toTarget(a.target) : undefined,
        to: a.to ? toTarget(a.to) : undefined,
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
      renderFeedback(r, obs, { changes: true }) + counters,
      r.status === "failed" || r.status === "blocked",
    );
  }

  async observe(level: ObservationLevel = "outline", ref?: string): Promise<ToolResult> {
    const session = await this.ensure();
    const obs = await session.observe({ level, ref });
    return this.text(renderFeedback(undefined, obs));
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
