/**
 * Track B: what an actor is shown while completing the same form task.
 *
 * Compares (a) Playwright MCP (published @playwright/mcp) driven by a scripted client with
 * (b) Vedha exploration at observation levels outline/controls with and without deltas.
 * Both are driven by deterministic scripts (no LLM): this measures the *size and number of
 * messages an actor would have to read*, a proxy for token cost. Tokens are NOT measured;
 * "approxTokens" = chars/4 is a rough convention only.
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PlaywrightAdapter } from "@vedha/adapter-playwright";
import { RuleActor, Session, explore } from "@vedha/core";
import { ShopServer } from "../fixtures/shop.js";

const TRIALS = Number(process.argv[2] ?? "10");
const OUT = path.resolve(process.argv[3] ?? "benchmarks/results/observation-track");

interface Row {
  system: string;
  page: "/" | "/big";
  trial: number;
  messages: number;
  chars: number;
  approxTokens: number;
  wallMs: number;
  effectAchieved: boolean;
  notes?: string;
}

const textOf = (res: unknown): string => {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`)).join("\n");
};

async function mcpTrial(
  page: Row["page"],
  trial: number,
  toolsOut: { names?: string[]; schema?: unknown },
  reuseRefs: boolean,
): Promise<Row> {
  const server = new ShopServer({ seed: trial + 1 });
  const base = await server.start();
  const entry = path.resolve("benchmarks/node_modules/@playwright/mcp/cli.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, "--headless", "--isolated", "--browser", "chromium"],
    stderr: "ignore",
  });
  const client = new Client({ name: "af-bench", version: "0.0.0" });
  await client.connect(transport);
  let messages = 0,
    chars = 0;
  const t0 = Date.now();
  try {
    const tools = await client.listTools();
    toolsOut.names = tools.tools.map((t) => t.name);
    const byName = new Map(tools.tools.map((t) => [t.name, t]));
    const refKey = (tool: string) =>
      "target" in ((byName.get(tool)?.inputSchema as { properties?: object })?.properties ?? {})
        ? "target"
        : "ref";
    toolsOut.schema = {
      browser_click: byName.get("browser_click")?.inputSchema,
      browser_type: byName.get("browser_type")?.inputSchema,
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      const text = textOf(res);
      messages++;
      chars += text.length;
      return text;
    };
    const refFor = (snap: string, role: string, name: RegExp): string => {
      const line = snap
        .split("\n")
        .find((l) => l.includes(`${role}`) && name.test(l) && /\[ref=([A-Za-z0-9]+)\]/.test(l));
      const m = line && /\[ref=([A-Za-z0-9]+)\]/.exec(line);
      if (!m) throw new Error(`no ref for ${role} ${name}`);
      return m[1]!;
    };
    let snap = await call("browser_navigate", { url: `${base}${page}` });
    const fresh = async () => {
      if (!reuseRefs && !/\[ref=/.test(snap)) snap = await call("browser_snapshot", {});
    };
    if (!/\[ref=/.test(snap)) {
      const full = await call("browser_snapshot", {});
      snap = full;
    }
    const base0 = snap;
    snap = await call("browser_type", {
      element: "Name",
      [refKey("browser_type")]: refFor(snap, "textbox", /Name/),
      text: "Ada",
    });
    await fresh();
    if (reuseRefs) snap = base0;
    snap = await call("browser_type", {
      element: "Quantity",
      [refKey("browser_type")]: refFor(snap, "spinbutton", /Quantity/),
      text: "3",
    });
    await fresh();
    if (reuseRefs) snap = base0;
    const final = await call("browser_click", {
      element: "Place order",
      [refKey("browser_click")]: refFor(snap, "button", /Place order/),
    });
    await new Promise((r) => setTimeout(r, 300));
    const oracle = await server.oracle();
    return {
      system: reuseRefs
        ? "playwright-mcp, snapshot once + reuse refs"
        : "playwright-mcp, re-snapshot after each action",
      page,
      trial,
      messages,
      chars,
      approxTokens: Math.round(chars / 4),
      wallMs: Date.now() - t0,
      effectAchieved:
        oracle.orders.length === 1 &&
        oracle.orders[0]!.qty === 3 &&
        oracle.orders[0]!.name === "Ada",
      notes: /Order placed/.test(final)
        ? "success text visible in final response"
        : "success text not in final response",
    };
  } finally {
    await client.close().catch(() => undefined);
    await server.stop();
  }
}

async function afTrial(
  page: Row["page"],
  trial: number,
  mode: { level: "controls" | "outline"; delta: boolean; label: string },
): Promise<Row> {
  const server = new ShopServer({ seed: trial + 1 });
  const base = await server.start();
  const adapter = await PlaywrightAdapter.launch();
  const t0 = Date.now();
  try {
    const session = await Session.create(adapter, {});
    const actor = new RuleActor({
      fields: [
        { name: /name/i, value: "Ada", role: "textbox" },
        { name: /quantity/i, value: "3", role: "spinbutton" },
      ],
      submit: {
        name: /place order/i,
        mutating: true,
        postconditions: [
          { type: "text", target: { role: "status" }, contains: "Order placed" },
          {
            type: "network",
            method: "POST",
            urlPattern: "/api/orders",
            status: "2xx",
            json: { path: "qty", equals: 3 },
          },
        ],
        reconcile: { type: "api", get: "/api/orders", matchesAny: { name: "Ada", qty: 3 } },
      },
    });
    let obsChars = 0,
      messages = 0;
    // Wrap observe to apply the requested level/delta and count what the actor would read.
    const origObserve = session.observe.bind(session);
    session.observe = async (o = {}) => {
      const obs = await origObserve({ ...o, level: mode.level, delta: mode.delta && o.delta });
      obsChars += obs.text.length;
      messages++;
      return obs;
    };
    await explore(session, actor, {
      goal: "place an order for Ada, quantity 3",
      startUrl: `${base}${page}`,
      maxSteps: 8,
      observation: { delta: mode.delta },
    });
    const report = session.report();
    const resultChars = report.steps.reduce(
      (n, r) =>
        n +
        JSON.stringify({ id: r.actionId, status: r.status, recovered: r.recovered, error: r.error })
          .length,
      0,
    );
    const oracle = await server.oracle();
    const chars = obsChars + resultChars;
    return {
      system: `vedha ${mode.label}`,
      page,
      trial,
      messages: messages + report.steps.length,
      chars,
      approxTokens: Math.round(chars / 4),
      wallMs: Date.now() - t0,
      effectAchieved:
        oracle.orders.length === 1 &&
        oracle.orders[0]!.qty === 3 &&
        oracle.orders[0]!.name === "Ada",
      notes: `verdict=${report.verdict}`,
    };
  } finally {
    await adapter.close();
    await server.stop();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows: Row[] = [];
  const toolsOut: { names?: string[]; schema?: unknown } = {};
  for (let t = 0; t < TRIALS; t++) {
    for (const page of ["/", "/big"] as const) {
      rows.push(await mcpTrial(page, t, toolsOut, false));
      rows.push(await mcpTrial(page, t, toolsOut, true));
      rows.push(
        await afTrial(page, t, {
          level: "outline",
          delta: false,
          label: "outline (full ARIA each turn)",
        }),
      );
      rows.push(await afTrial(page, t, { level: "controls", delta: false, label: "controls" }));
      rows.push(
        await afTrial(page, t, { level: "controls", delta: true, label: "controls+delta" }),
      );
      process.stderr.write(`trial ${t + 1}/${TRIALS} ${page}\n`);
    }
  }
  fs.writeFileSync(path.join(OUT, "rows.json"), JSON.stringify(rows, null, 1));
  fs.writeFileSync(path.join(OUT, "mcp-tools.json"), JSON.stringify(toolsOut, null, 1));
  const systems = [...new Set(rows.map((r) => r.system))];
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const lines = [
    "| page | system | messages (median) | chars (median) | ≈tokens | effect achieved |",
    "|---|---|---|---|---|---|",
  ];
  for (const page of ["/", "/big"] as const)
    for (const s of systems) {
      const rs = rows.filter((r) => r.page === page && r.system === s);
      lines.push(
        `| ${page} | ${s} | ${med(rs.map((r) => r.messages))} | ${med(rs.map((r) => r.chars))} | ${med(rs.map((r) => r.approxTokens))} | ${rs.filter((r) => r.effectAchieved).length}/${rs.length} |`,
      );
    }
  fs.writeFileSync(
    path.join(OUT, "results.md"),
    `# Observation track\n\nScripted actors, n=${TRIALS} per cell. Wall time is recorded in rows.json but not tabulated: the MCP path includes server spawn and browser launch, Vedha does not. chars = characters an actor would read (observations + action results / MCP tool responses). ≈tokens = chars/4, a rough convention, not a tokenizer measurement.\n\n${lines.join("\n")}\n`,
  );
  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
