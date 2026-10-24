import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShopServer } from "../fixtures/shop.js";

const DIR = path.resolve("benchmarks/.pw-fixture");
let ok: ShopServer;
let bug: ShopServer;
let okUrl: string;
let bugUrl: string;

const SPEC = `
import { test } from "@vedhajs/playwright-test";
const steps = (base: string) => [
  { id: "open", intent: "open", op: "goto" as const, value: base + "/",
    postconditions: [{ type: "state" as const, target: { label: "Name", exact: true }, state: "visible" as const }] },
  { id: "name", intent: "name", op: "fill" as const, target: { label: "Name", exact: true }, value: "Ada" },
  { id: "qty", intent: "quantity", op: "fill" as const, target: { label: "Quantity", exact: true }, value: "3" },
  { id: "submit", intent: "place the order", op: "click" as const, mutating: true,
    target: { role: "button", name: "Place order" },
    postconditions: [{ type: "text" as const, target: { role: "status" }, contains: "Order placed" }] },
];

test("places an order", async ({ vedha }) => {
  for (const s of steps(process.env.OK_URL!)) await vedha.verify(s);
});

test("a silent server error fails the test with the reason", async ({ vedha }) => {
  for (const s of steps(process.env.BUG_URL!)) await vedha.verify(s);
});

test.describe("non-strict", () => {
  test.use({ vedhaStrict: false });
  test("keeps going, attaches the bundle", async ({ vedha }) => {
    for (const s of steps(process.env.BUG_URL!)) await vedha.step(s);
  });
});
`;

beforeAll(async () => {
  ok = new ShopServer({});
  bug = new ShopServer({ bug: "silent" });
  okUrl = await ok.start();
  bugUrl = await bug.start();
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIR, "playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "*.spec.ts", retries: 0, reporter: "json",
  use: { headless: true } });`,
  );
  fs.writeFileSync(path.join(DIR, "a.spec.ts"), SPEC);
});

afterAll(async () => {
  await ok.stop();
  await bug.stop();
  fs.rmSync(DIR, { recursive: true, force: true });
});

interface Spec {
  title: string;
  tests: Array<{
    results: Array<{
      status: string;
      error?: { message?: string };
      attachments: Array<{ name: string }>;
    }>;
  }>;
}

/** Async on purpose: the fixture servers live in this process and must keep answering. */
async function runPlaywright(): Promise<Spec[]> {
  const out = await new Promise<string>((resolve) => {
    execFile(
      process.execPath,
      [
        path.resolve("benchmarks/node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        path.join(DIR, "playwright.config.ts"),
      ],
      { env: { ...process.env, OK_URL: okUrl, BUG_URL: bugUrl, CI: "1" }, maxBuffer: 20_000_000 },
      (_err, stdout) => resolve(stdout),
    );
  });
  const report = JSON.parse(out) as {
    suites: Array<{ specs: Spec[]; suites?: Array<{ specs: Spec[] }> }>;
  };
  return report.suites.flatMap((s) => [...s.specs, ...(s.suites ?? []).flatMap((x) => x.specs)]);
}

describe("@vedhajs/playwright-test", () => {
  it("passes a verified test, fails a hidden server error with the reason, and attaches evidence", async () => {
    const specs = await runPlaywright();
    const by = (t: string) => specs.find((s) => s.title.startsWith(t))!.tests[0]!.results[0]!;

    const healthy = by("places an order");
    expect(healthy.status).toBe("passed");
    expect(healthy.attachments.map((a) => a.name)).toContain("vedha-report.json");

    const hidden = by("a silent server error");
    expect(hidden.status).toBe("failed");
    expect(hidden.error?.message).toContain("health_check_failed");
    expect(hidden.error?.message).toContain("POST /api/orders returned 500");

    const lenient = by("keeps going");
    expect(lenient.status).toBe("passed");
    expect(lenient.attachments.map((a) => a.name)).toContain("vedha-failure-bundle.json");
  }, 120_000);
});
