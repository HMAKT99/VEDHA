/**
 * B7: security red-team over the Model Context Protocol. The same scripted tool calls drive the real
 * `@playwright/mcp` and `@vedha/mcp` servers, each configured the way its documentation recommends for
 * restricting a browser to one origin and redacting a secret. The "disallowed" origin is `localhost`
 * on the same fixture server (the allowed origin is `127.0.0.1`), so server-side counters show exactly
 * what reached it. No model is involved.
 *
 * Usage: tsx benchmarks/tracks/redteam.ts [trials=3] [out-dir]
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ShopServer } from "../fixtures/shop.js";

const TRIALS = Number(process.argv[2] ?? "3");
const OUT = path.resolve(process.argv[3] ?? "benchmarks/results/redteam");
const SECRET = "hunter2-correct-horse";

type Call = (name: string, args: Record<string, unknown>) => Promise<string>;
interface Arm {
  id: string;
  start(
    allowed: { origin: string; host: string },
    secretFile: string,
  ): { command: string; args: string[] };
  /** Open a URL; returns tool text. */
  open(call: Call, url: string): Promise<string>;
  click(call: Call, snapshotText: string, name: string): Promise<string>;
  type(call: Call, snapshotText: string, label: string, text: string): Promise<string>;
  look(call: Call): Promise<string>;
}

const refOf = (snapshot: string, role: string, name: string): string | undefined =>
  new RegExp(`${role}[^\\n]*"${name}"[^\\n]*\\[ref=([A-Za-z0-9]+)\\]`).exec(snapshot)?.[1];

const arms: Arm[] = [
  {
    id: "mcp-playwright",
    start: (a, secretFile) => ({
      command: process.execPath,
      args: [
        path.resolve("benchmarks/node_modules/@playwright/mcp/cli.js"),
        "--headless",
        "--isolated",
        "--browser",
        "chromium",
        "--allowed-origins",
        a.origin,
        "--secrets",
        secretFile,
        "--output-dir",
        path.resolve("benchmarks/results/redteam/.pw-mcp"),
      ],
    }),
    // The navigate result links a snapshot file instead of inlining it, so take an explicit snapshot.
    open: async (call, url) =>
      (await call("browser_navigate", { url })) + "\n" + (await call("browser_snapshot", {})),
    click: async (call, snap, name) => {
      const ref = refOf(snap, "button", name);
      return ref ? call("browser_click", { element: name, target: ref }) : "no such element";
    },
    type: async (call, snap, label, text) => {
      const ref = refOf(snap, "textbox", label);
      return ref ? call("browser_type", { element: label, target: ref, text }) : "no such element";
    },
    look: (call) => call("browser_snapshot", {}),
  },
  {
    id: "mcp-vedha",
    start: (a) => ({
      command: process.execPath,
      args: [
        path.resolve("packages/mcp/dist/bin.js"),
        "--allow-domain",
        a.host,
        "--secret",
        SECRET,
      ],
    }),
    open: (call, url) => call("vedha_act", { op: "goto", intent: "open", value: url }),
    click: (call, _s, name) =>
      call("vedha_act", { op: "click", intent: `click ${name}`, target: { role: "button", name } }),
    type: (call, _s, label, text) =>
      call("vedha_act", {
        op: "fill",
        intent: `type into ${label}`,
        target: { label },
        value: text,
      }),
    look: (call) => call("vedha_observe", {}),
  },
];

interface Case {
  id: string;
  title: string;
  run(
    arm: Arm,
    call: Call,
    base: string,
    port: string,
  ): Promise<{ note: string; secretSeen?: boolean }>;
}

const cases: Case[] = [
  {
    id: "R1-redirect-hop",
    title: "GET redirect from the allowed origin to a disallowed origin",
    run: async (arm, call, base, port) => ({
      note: (
        await arm.open(
          call,
          `${base}/redirect?to=${encodeURIComponent(`http://localhost:${port}/leak`)}`,
        )
      ).slice(0, 120),
    }),
  },
  {
    id: "R2-post-redirect",
    title: "POST whose 303 redirect points at a disallowed origin",
    run: async (arm, call, base) => {
      const snap = await arm.open(call, `${base}/postform`);
      const clicked = await arm.click(call, snap, "Evil");
      if (/Invalid arguments|no such element|ERROR/.test(clicked))
        throw new Error(`click call failed: ${clicked.slice(0, 80)}`);
      return { note: clicked.slice(0, 120) };
    },
  },
  {
    id: "R3-subresources",
    title: "Page loads an image, fetches and a pixel from a disallowed origin",
    run: async (arm, call, base) => ({
      note: (await arm.open(call, `${base}/subres`)).slice(0, 120),
    }),
  },
  {
    id: "R4-websocket",
    title: "Page opens a WebSocket to a disallowed origin",
    run: async (arm, call, base) => ({
      note: (await arm.open(call, `${base}/ws-page`)).slice(0, 120),
    }),
  },
  {
    id: "R5-secret-echo",
    title: "A configured secret typed into a field must not appear in tool results",
    run: async (arm, call, base) => {
      const snap = await arm.open(call, `${base}/`);
      const typed = await arm.type(call, snap, "Name", SECRET);
      if (/Invalid arguments|no such element|ERROR/.test(typed))
        throw new Error(`type call failed: ${typed.slice(0, 80)}`);
      const seen = typed + (await arm.look(call));
      return { note: "typed then observed", secretSeen: seen.includes(SECRET) };
    },
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const secretFile = path.join(OUT, ".secrets.env");
  fs.writeFileSync(secretFile, `FIXTURE_SECRET=${SECRET}\n`);
  const rows: Array<Record<string, unknown>> = [];
  for (let t = 0; t < TRIALS; t++) {
    for (const c of cases) {
      for (const arm of arms) {
        const server = new ShopServer({});
        const base = await server.start();
        const port = new URL(base).port;
        const origin = `http://127.0.0.1:${port}`;
        const spec = arm.start({ origin, host: "127.0.0.1" }, secretFile);
        const client = new Client({ name: "redteam", version: "0.0.0" });
        await client.connect(
          new StdioClientTransport({ command: spec.command, args: spec.args, stderr: "pipe" }),
        );
        const call: Call = async (name, args) => {
          try {
            const r = await client.callTool({ name, arguments: args });
            return ((r.content as Array<{ text?: string }>) ?? [])
              .map((p) => p.text ?? "")
              .join("\n");
          } catch (e) {
            return `ERROR ${e instanceof Error ? e.message : String(e)}`;
          }
        };
        let note = "";
        let secretSeen: boolean | undefined;
        try {
          ({ note, secretSeen } = await c.run(arm, call, base, port));
        } catch (e) {
          note = `harness error: ${e instanceof Error ? e.message : String(e)}`;
        }
        await new Promise((r) => setTimeout(r, 800)); // let late requests land
        const o = await server.oracle();
        rows.push({
          case: c.id,
          arm: arm.id,
          trial: t,
          leaks: o.leaks,
          upgrades: o.upgrades,
          secretSeen,
          note,
        });
        await call("vedha_close", {}).catch(() => undefined);
        await client.close().catch(() => undefined);
        await server.stop();
        process.stderr.write(
          `${c.id} ${arm.id} t${t}: leaks=${o.leaks} upgrades=${o.upgrades}${secretSeen === undefined ? "" : ` secretSeen=${secretSeen}`}\n`,
        );
      }
    }
  }
  fs.writeFileSync(path.join(OUT, "rows.json"), JSON.stringify(rows, null, 1));
  const lines = [
    "# B7 red-team results (MCP vs MCP, scripted, no model)",
    "",
    `Trials per cell: ${TRIALS}. Allowed origin 127.0.0.1; the "disallowed" origin is localhost on the same server. Each server configured as documented for origin restriction and secret redaction (Playwright MCP: \`--allowed-origins\`, \`--secrets\`; Vedha: \`--allow-domain\`, \`--secret\`).`,
    "",
    "| case | mcp-playwright (leaks+upgrades / secret seen) | mcp-vedha |",
    "| --- | --- | --- |",
  ];
  for (const c of cases) {
    const cell = (armId: string) => {
      const rs = rows.filter((r) => r.case === c.id && r.arm === armId);
      const reached = rs.filter((r) => Number(r.leaks) + Number(r.upgrades) > 0).length;
      const seen = rs.filter((r) => r.secretSeen === true).length;
      return c.id === "R5-secret-echo"
        ? `secret seen in ${seen}/${rs.length}`
        : `reached disallowed origin in ${reached}/${rs.length}`;
    };
    lines.push(`| ${c.id}: ${c.title} | ${cell("mcp-playwright")} | ${cell("mcp-vedha")} |`);
  }
  fs.writeFileSync(path.join(OUT, "results.md"), lines.join("\n") + "\n");
  process.stdout.write(lines.join("\n") + "\n");
  fs.rmSync(secretFile, { force: true });
}
void main();
