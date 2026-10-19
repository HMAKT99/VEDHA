import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShopServer } from "../fixtures/shop.js";
import { SCENARIOS } from "../scenarios/index.js";

const WORK = path.resolve("benchmarks/results/.test-work-cli");
const BIN = path.resolve("packages/cli/src/bin.ts");
const TSX = path.resolve("node_modules/.bin/tsx");

function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn(TSX, [BIN, ...args], { cwd: WORK, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    c.stdout.on("data", (d: Buffer) => (stdout += d));
    c.stderr.on("data", (d: Buffer) => (stderr += d));
    c.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const specFor = (id: string) => ({
  goal: id,
  steps: SCENARIOS.find((s) => s.id.startsWith(id))!.steps,
});

beforeAll(() => fs.mkdirSync(WORK, { recursive: true }));
afterAll(() => fs.rmSync(WORK, { recursive: true, force: true }));

describe("vedha CLI (end to end)", () => {
  it("prints help and rejects unknown commands", async () => {
    expect((await cli(["--help"])).code).toBe(0);
    const bad = await cli(["nope"]);
    expect(bad.code).toBe(3);
  });

  it("rejects an invalid spec with exit 3 and a clear message", async () => {
    fs.writeFileSync(
      path.join(WORK, "bad.json"),
      JSON.stringify({ steps: [{ id: "a", intent: "x", op: "click" }] }),
    );
    const r = await cli(["run", "bad.json"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("requires a target");
  });

  it("run: exit 0 on a passing spec; exit 1 + failure bundle on a defect; replay reproduces it", async () => {
    const ok = new ShopServer({});
    const okUrl = await ok.start();
    fs.writeFileSync(path.join(WORK, "s01.json"), JSON.stringify(specFor("S01")));
    const pass = await cli(["run", "s01.json", "--base-url", okUrl]);
    await ok.stop();
    expect(pass.code, pass.stderr).toBe(0);
    expect(JSON.parse(pass.stdout).verdict).toBe("passed");

    const bad = new ShopServer({ bug: "silent" });
    const badUrl = await bad.start();
    fs.writeFileSync(path.join(WORK, "s06.json"), JSON.stringify(specFor("S06")));
    const fail = await cli(["run", "s06.json", "--base-url", badUrl, "--out", "bundle1"]);
    expect(fail.code, fail.stderr).toBe(1);
    expect(JSON.parse(fail.stdout).verdict).toBe("failed");
    expect(fs.existsSync(path.join(WORK, "bundle1", "bundle.json"))).toBe(true);
    const replay = await cli(["replay", "bundle1", "--base-url", badUrl]);
    await bad.stop();
    expect(replay.code, replay.stderr).toBe(0); // same failure reproduced => no divergence
    expect(JSON.parse(replay.stdout).divergences).toEqual([]);
  }, 120_000);

  it("run: exit 2 when policy blocks navigation", async () => {
    fs.writeFileSync(
      path.join(WORK, "evil.json"),
      JSON.stringify({
        steps: [{ id: "g", intent: "go", op: "goto", value: "https://evil.example/" }],
      }),
    );
    const r = await cli(["run", "evil.json", "--allow-domain", "127.0.0.1"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).verdict).toBe("blocked");
  }, 60_000);

  it("explore + promote --check produces a spec that passes", async () => {
    const app = new ShopServer({});
    const url = await app.start();
    const goal = {
      goal: "place an order for Ada",
      fields: [
        { name: "name", value: "Ada", role: "textbox" },
        { name: "quantity", value: "3", role: "spinbutton" },
      ],
      submit: {
        name: "place order",
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
    };
    fs.writeFileSync(path.join(WORK, "goal.json"), JSON.stringify(goal));
    const fresh = new ShopServer({});
    const freshUrl = await fresh.start();
    const r = await cli([
      "explore",
      "goal.json",
      "--start-url",
      `${url}/`,
      "--promote",
      "order.spec.ts",
      "--check",
      freshUrl,
    ]);
    await app.stop();
    const freshOrders = (await fresh.oracle()).orders;
    await fresh.stop();
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(JSON.parse(r.stdout).proposal.replayCheck.passed).toBe(true);
    expect(freshOrders).toHaveLength(1);
    expect(fs.readFileSync(path.join(WORK, "order.spec.ts"), "utf8")).toContain("getByRole");
  }, 180_000);

  it("schemas writes versioned JSON schema files", async () => {
    const r = await cli(["schemas", "--out", "schemas"]);
    expect(r.code).toBe(0);
    expect(fs.readdirSync(path.join(WORK, "schemas")).some((f) => f.includes("action-spec"))).toBe(
      true,
    );
  });
});
