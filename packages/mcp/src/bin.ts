#!/usr/bin/env node
import { parseConfig, runStdio } from "./index.js";

try {
  const config = parseConfig(process.argv.slice(2));
  await runStdio(config);
} catch (e) {
  process.stderr.write(`vedha-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}
