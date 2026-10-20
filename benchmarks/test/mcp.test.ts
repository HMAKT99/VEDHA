import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ShopServer, type Variant } from "../fixtures/shop.js";

const BIN = path.resolve("packages/mcp/dist/bin.js");

type Content = Array<{ type: string; text?: string }>;
const textOf = (r: unknown): string =>
  ((r as { content: Content }).content ?? []).map((c) => c.text ?? "").join("\n");
const isError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

async function connect(variant: Variant, extraArgs: string[] = []) {
  const shop = new ShopServer(variant);
  const base = await shop.start();
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [BIN, "--allow-domain", "127.0.0.1", ...extraArgs],
      stderr: "pipe",
    }),
  );
  cleanup.push(async () => {
    await client.callTool({ name: "vedha_close", arguments: {} }).catch(() => undefined);
    await client.close();
    await shop.stop();
  });
  const act = (args: Record<string, unknown>) =>
    client.callTool({ name: "vedha_act", arguments: args });
  return { shop, base, client, act };
}

const placeOrder = {
  op: "click",
  intent: "place the order",
  target: { role: "button", name: "Place order" },
  mutating: true,
  expect: { text_contains: "Order placed" },
};

async function fillForm(act: (a: Record<string, unknown>) => Promise<unknown>) {
  await act({ op: "fill", intent: "name", target: { label: "Name" }, value: "Ada" });
  await act({ op: "fill", intent: "quantity", target: { label: "Quantity" }, value: "3" });
}

describe("vedha-mcp (stdio, real client)", () => {
  it("refuses to start without a domain policy", () => {
    expect(() => execFileSync(process.execPath, [BIN], { stdio: "pipe" })).toThrow(
      /refusing to start without a domain policy/,
    );
  });

  it("lists the tools and completes a verified order", async () => {
    const { shop, base, client, act } = await connect({});
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      "vedha_act",
      "vedha_bundle",
      "vedha_close",
      "vedha_observe",
      "vedha_promote",
      "vedha_report",
    ]);
    const open = await act({
      op: "goto",
      intent: "open the shop",
      value: base + "/",
      expect: { url_contains: "/" },
    });
    expect(textOf(open)).toContain("Place order");
    await fillForm(act);
    const done = await act(placeOrder);
    expect(isError(done)).toBe(false);
    expect(textOf(done)).toContain("result: verified");
    // What the action did: the write request, and what changed on the page.
    expect(textOf(done)).toContain("requests: POST /api/orders 201");
    expect(textOf(done)).toContain("changed on the page");
    expect(textOf(done)).toMatch(/\+ .*Order placed/);
    expect((await shop.oracle()).orders).toHaveLength(1);
    const report = JSON.parse(
      textOf(await client.callTool({ name: "vedha_report", arguments: {} })),
    );
    expect(report.verdict).toBe("passed");
  }, 60_000);

  it("reports a silent 500 as failed even though the UI says success and no request was declared", async () => {
    const { base, act } = await connect({ bug: "silent" });
    await act({ op: "goto", intent: "open", value: base + "/" });
    await fillForm(act);
    const r = await act(placeOrder);
    expect(isError(r)).toBe(true);
    expect(textOf(r)).toContain("health_check_failed");
    expect(textOf(r)).toContain("POST /api/orders returned 500");
  }, 60_000);

  it("gives advice for a wrong op and does not touch the page", async () => {
    const { base, act } = await connect({});
    await act({ op: "goto", intent: "open", value: base + "/" });
    const r = await act({
      op: "fill",
      intent: "pick product",
      target: { role: "button", name: "Place order" },
      value: "x",
    });
    expect(isError(r)).toBe(true);
    expect(textOf(r)).toContain("invalid_action");
    expect(textOf(r)).toContain('use op "click"');
  }, 60_000);

  it("a wrong expectation fails on an idle page; repeating is refused; an independent check confirms it", async () => {
    const { shop, base, client, act } = await connect({});
    await act({
      op: "goto",
      intent: "open",
      value: base + "/",
      expect: { url_contains: "/" },
    });
    await fillForm(act);
    // The typed name is an input value, not page text, so this check cannot pass.
    const wrong = { ...placeOrder, expect: { text_contains: "Ada" } };
    const first = await act(wrong);
    // The page is idle after the click, so the unmet check is a failure, not an unknown outcome.
    expect(textOf(first)).toContain("result: failed (expectation_not_met)");
    expect(textOf(first)).toContain("do not repeat");
    const again = await act(wrong);
    expect(isError(again)).toBe(true);
    expect(textOf(again)).toContain("refused");
    expect((await shop.oracle()).orders).toHaveLength(1); // not submitted twice
    const confirm = await act({
      op: "wait",
      intent: "confirm the order was placed",
      confirms: "step-4",
      expect: { text_contains: "Order placed" },
    });
    expect(textOf(confirm)).toContain("result: verified");
    const report = JSON.parse(
      textOf(await client.callTool({ name: "vedha_report", arguments: {} })),
    );
    expect(report.verdict).toBe("passed_with_recovery");
    expect((await shop.oracle()).orders).toHaveLength(1);
  }, 90_000);

  it("redacts configured secrets from every tool result", async () => {
    const { base, client, act } = await connect({}, ["--secret", "hunter2-secret"]);
    await act({ op: "goto", intent: "open", value: base + "/", expect: { url_contains: "/" } });
    const filled = await act({
      op: "fill",
      intent: "type a secret into the name field",
      target: { label: "Name" },
      value: "hunter2-secret",
    });
    // The page's accessibility tree now contains the value; the model must not see it.
    expect(textOf(filled)).not.toContain("hunter2-secret");
    expect(textOf(filled)).toContain("[REDACTED]");
    const observed = await client.callTool({ name: "vedha_observe", arguments: {} });
    expect(textOf(observed)).not.toContain("hunter2-secret");
  }, 60_000);

  it("warns after three failed steps in a row so the model can stop and report", async () => {
    const { base, act } = await connect({});
    await act({ op: "goto", intent: "open", value: base + "/", expect: { url_contains: "/" } });
    let last = "";
    for (let i = 0; i < 3; i++)
      last = textOf(
        await act({
          op: "click",
          intent: `click a missing button ${i}`,
          target: { role: "button", name: "Does not exist" },
        }),
      );
    expect(last).toContain("WARNING: 3 steps in a row did not verify");
  }, 90_000);

  it("blocks navigation outside the allowed domain", async () => {
    const { act } = await connect({});
    const r = await act({ op: "goto", intent: "leave", value: "http://example.com/" });
    expect(isError(r)).toBe(true);
    expect(textOf(r)).toContain("blocked");
  }, 60_000);

  it("promotes the verified steps to a Playwright spec", async () => {
    const { base, client, act } = await connect({});
    await act({ op: "goto", intent: "open", value: base + "/" });
    await fillForm(act);
    await act(placeOrder);
    const r = await client.callTool({
      name: "vedha_promote",
      arguments: { title: "place an order", goal: "place an order" },
    });
    expect(textOf(r)).toContain('import { test, expect } from "@playwright/test"');
    expect(textOf(r)).toContain("Place order");
  }, 60_000);
});
