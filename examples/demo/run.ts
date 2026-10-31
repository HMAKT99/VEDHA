// 20-second demo: the page says "Order placed", the server returned 500 and stored nothing.
// Same flow, same "Order placed" check, run by plain Playwright and by Vedha.
//   pnpm build && npx tsx examples/demo/run.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { ShopServer } from "../../benchmarks/fixtures/shop.js";

const shop = new ShopServer({ bug: "silent" });
const url = await shop.start();
console.log(
  `Order form with a bug: the server answers 500 and stores nothing; the page says "Order placed".\n`,
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.getByLabel("Name").fill("Ada");
await page.getByRole("button", { name: "Place order" }).click();
await expect(page.getByRole("status")).toContainText("Order placed");
await browser.close();
console.log('Playwright  PASS   "Order placed" is on the page');

// Async on purpose: the fixture server runs in this process and must keep answering.
const run = promisify(execFile);
let out = "";
try {
  out = (
    await run("node", [
      "packages/cli/dist/bin.js",
      "run",
      "examples/demo/typical.json",
      "--base-url",
      url,
    ])
  ).stdout;
} catch (e) {
  out = (e as { stdout: string }).stdout; // exit 1 = a step failed
}
const submit = JSON.parse(out).steps.find((s: { actionId: string }) => s.actionId === "submit");
console.log(`Vedha       ${submit.status.toUpperCase()} ${submit.error?.message ?? ""}`);

const stored = (await shop.oracle()).orders.length;
console.log(`Server      ${stored} orders stored\n`);
await shop.stop();
