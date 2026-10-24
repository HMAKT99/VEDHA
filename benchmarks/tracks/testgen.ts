/**
 * B8: quality of the regression test an exploration promotes. A RuleActor explores the healthy shop
 * through Vedha (declaring the same checks any author would), the proposal is promoted to a Playwright
 * spec, and that spec is run against healthy and broken variants of the app. Two reference specs are
 * built from the same steps: "actions only" (what a recorder produces) and "actions + visible text"
 * (a recorder plus the one assertion a person usually adds). Measures: pass on healthy variants,
 * and kill (spec fails) on defect variants. The references are constructed by this project; they stand
 * for typical practice and are not a named product.
 *
 * Usage: tsx benchmarks/tracks/testgen.ts [runs=3] [out-dir]
 */
import fs from "node:fs";
import path from "node:path";
import { PlaywrightAdapter, runGeneratedSpec } from "@vedhajs/adapter-playwright";
import { RuleActor, Session, explore, promote } from "@vedhajs/core";
import type { TestProposal } from "@vedhajs/core";
import { ShopServer, type Variant } from "../fixtures/shop.js";

const RUNS = Number(process.argv[2] ?? "3");
const OUT = path.resolve(process.argv[3] ?? "benchmarks/results/testgen");
const WORK = path.resolve("benchmarks/results/.testgen-work");

const VARIANTS: Array<{ id: string; kind: "healthy" | "defect"; variant: Variant }> = [
  { id: "healthy", kind: "healthy", variant: {} },
  { id: "slow-ui (benign)", kind: "healthy", variant: { uiDelayMs: [400, 1200] } },
  { id: "cookie-banner (benign)", kind: "healthy", variant: { cookieBanner: true } },
  { id: "silent-500", kind: "defect", variant: { bug: "silent" } },
  { id: "wrong-quantity", kind: "defect", variant: { bug: "wrongqty" } },
  { id: "dropped-write", kind: "defect", variant: { bug: "dropped" } },
  { id: "disabled-submit", kind: "defect", variant: { disabledSubmit: true } },
];

async function explored(): Promise<TestProposal> {
  const server = new ShopServer({});
  const base = await server.start();
  const adapter = await PlaywrightAdapter.launch();
  try {
    const s = await Session.create(adapter, {});
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
    const res = await explore(s, actor, {
      goal: "place an order for Ada, quantity 3",
      startUrl: `${base}/`,
      maxSteps: 8,
    });
    return res.proposal;
  } finally {
    await adapter.close();
    await server.stop();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const proposal = await explored();
  const strip = (keep: Array<string>): TestProposal => ({
    ...proposal,
    steps: proposal.steps.map((s) => ({
      ...s,
      postconditions: (s.postconditions ?? []).filter((v) => keep.includes(v.type)),
      reconcile: undefined,
    })),
    assertions: [],
  });
  const specs = {
    "vedha-promoted": promote(proposal),
    "recorder (actions only)": promote(strip([])),
    "recorder + visible text": promote(strip(["text"])),
  };
  fs.writeFileSync(path.join(OUT, "specs.json"), JSON.stringify(specs, null, 1));
  const rows: Array<{
    spec: string;
    variant: string;
    kind: string;
    run: number;
    passed: boolean;
    detail: string;
  }> = [];
  for (let run = 0; run < RUNS; run++) {
    for (const v of VARIANTS) {
      for (const [name, code] of Object.entries(specs)) {
        const server = new ShopServer({ ...v.variant, seed: run + 1 });
        const base = await server.start();
        const r = await runGeneratedSpec(
          code,
          base,
          path.join(WORK, `${name.replace(/\W+/g, "-")}-${run}`),
        );
        await server.stop();
        rows.push({
          spec: name,
          variant: v.id,
          kind: v.kind,
          run,
          passed: r.passed,
          detail: r.detail,
        });
        process.stderr.write(`${name} | ${v.id} | run ${run}: ${r.passed ? "pass" : "FAIL"}\n`);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, "rows.json"), JSON.stringify(rows, null, 1));
  const L = [
    "# B8 generated-test quality (3 runs per cell; references are constructed by this project)",
    "",
  ];
  L.push(
    "| spec | healthy variants passing (want 100%) | defect variants caught (kill rate) |",
    "| --- | --- | --- |",
  );
  for (const name of Object.keys(specs)) {
    const m = rows.filter((r) => r.spec === name);
    const h = m.filter((r) => r.kind === "healthy"),
      d = m.filter((r) => r.kind === "defect");
    L.push(
      `| ${name} | ${h.filter((r) => r.passed).length}/${h.length} | ${d.filter((r) => !r.passed).length}/${d.length} |`,
    );
  }
  L.push(
    "",
    "| variant | kind | " + Object.keys(specs).join(" | ") + " |",
    "| --- | --- | " +
      Object.keys(specs)
        .map(() => "---")
        .join(" | ") +
      " |",
  );
  for (const v of VARIANTS)
    L.push(
      `| ${v.id} | ${v.kind} | ${Object.keys(specs)
        .map((n) => {
          const m = rows.filter((r) => r.spec === n && r.variant === v.id);
          return `${m.filter((r) => r.passed).length}/${m.length} pass`;
        })
        .join(" | ")} |`,
    );
  fs.writeFileSync(path.join(OUT, "results.md"), L.join("\n") + "\n");
  process.stdout.write(L.join("\n") + "\n");
  fs.rmSync(WORK, { recursive: true, force: true });
}
void main();
