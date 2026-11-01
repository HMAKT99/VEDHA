import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  reporter: "list",
  workers: 1,
  outputDir: path.join(os.tmpdir(), "vedha-guard-demo"),
  use: { headless: true },
});
