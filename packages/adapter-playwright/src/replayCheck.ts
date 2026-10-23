import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Runs a generated Playwright Test spec against `baseURL` and reports pass/fail.
 * `workDir` must live under a directory from which `@playwright/test` is resolvable.
 */
export async function runGeneratedSpec(
  specSource: string,
  baseURL: string,
  workDir: string,
  timeoutMs = 90_000,
): Promise<{ passed: boolean; detail: string }> {
  const dir = path.resolve(workDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "generated.spec.ts"), specSource);
  fs.writeFileSync(
    path.join(dir, "playwright.config.ts"),
    `export default { testDir: ".", testMatch: "generated.spec.ts", timeout: 30000, retries: 0, reporter: [["json", { outputFile: "result.json" }]], use: { baseURL: ${JSON.stringify(baseURL)}, headless: true } };\n`,
  );
  const require = createRequire(path.join(dir, "x.js"));
  const cli = require.resolve("@playwright/test/cli");
  const out = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [cli, "test", "--config", path.join(dir, "playwright.config.ts")],
      {
        cwd: dir,
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(dir, "result.json") },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
  try {
    const res = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8")) as {
      stats?: { expected: number; unexpected: number; flaky: number };
    };
    const s = res.stats;
    if (s)
      return {
        passed: out.code === 0 && s.unexpected === 0 && s.expected >= 1,
        detail: `expected=${s.expected} unexpected=${s.unexpected} flaky=${s.flaky}`,
      };
  } catch {
    /* fall through */
  }
  return { passed: false, detail: `runner exited ${out.code}: ${out.stderr.slice(0, 300)}` };
}

/**
 * Runs the generated spec `runs` times against fresh state and reports flakiness: a test that passes some
 * runs and fails others is flaky and must not be committed as a regression test. `prepare` is called before
 * each run to return a fresh base URL (for example a freshly started app).
 */
export async function runGeneratedSpecRepeated(
  specSource: string,
  baseURL: string | (() => Promise<string>),
  workDir: string,
  runs: number,
): Promise<{ passed: boolean; detail: string; runs: number; passes: number; flaky: boolean }> {
  let passes = 0;
  let lastDetail = "";
  for (let i = 0; i < runs; i++) {
    const url = typeof baseURL === "string" ? baseURL : await baseURL();
    const r = await runGeneratedSpec(specSource, url, `${workDir}-${i}`);
    if (r.passed) passes++;
    lastDetail = r.detail;
  }
  const flaky = passes > 0 && passes < runs;
  return {
    passed: passes === runs,
    detail: `${passes}/${runs} runs passed${flaky ? " (FLAKY)" : ""}; last: ${lastDetail}`,
    runs,
    passes,
    flaky,
  };
}
