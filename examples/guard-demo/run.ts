// Guard-mode demo: the same Playwright test, once with @playwright/test and once with
// @vedhajs/playwright-test, against an order form whose API returns 500 while the page says "Order placed".
//   pnpm build && npx tsx examples/guard-demo/run.ts
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { ShopServer } from "../../benchmarks/fixtures/shop.js";

const shop = new ShopServer({ bug: "silent" });
const url = await shop.start();
const dir = path.dirname(new URL(import.meta.url).pathname);
let out = "";
try {
  // Async on purpose: the fixture server runs in this process and must keep answering.
  ({ stdout: out } = await promisify(execFile)(
    "npx",
    ["playwright", "test", "-c", path.join(dir, "playwright.config.ts")],
    { env: { ...process.env, BASE_URL: url, FORCE_COLOR: "1" } },
  ));
} catch (e) {
  out = (e as { stdout: string }).stdout; // exit 1: a test failed
}
// Keep Playwright's own output, minus stack frames, source excerpts and file hints.
const plain = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, "");
const noise = (l: string) =>
  /^\s*(at |Error Context:|>?\s*\d+ \||\|)/.test(plain(l)) || /test-results\//.test(l);
console.log(
  out
    .split("\n")
    .filter((l) => !noise(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n"),
);
await shop.stop();
