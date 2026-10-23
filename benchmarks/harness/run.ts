import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { ALL_DRIVERS, SELENIUM_DRIVERS } from "../drivers/index.js";
import type { Driver } from "../drivers/types.js";
import { SCENARIOS } from "../scenarios/index.js";
import { INDEPENDENT_SCENARIOS } from "../scenarios/independent.js";
import { MULTI_SCENARIOS } from "../scenarios/multi.js";
import { WIDGET_SCENARIOS, WIDGET_SCENARIOS_MINIMAL } from "../scenarios/widgets.js";
import { classify, oracleSummary, type TrialRecord } from "./classify.js";
import { makeServer } from "./servers.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const trials = Number(arg("trials", "20"));
const concurrency = Number(arg("concurrency", "4"));
const driverFilter = arg("drivers")?.split(",");
const scenarioFilter = arg("scenarios")?.split(",");
const runId = arg("run-id", new Date().toISOString().replace(/[:.]/g, "-"))!;
const outDir = path.resolve(arg("out", `benchmarks/results/${runId}`)!);
const TRIAL_TIMEOUT_MS = 90_000;

// --set seen (default): S01-S15. held-out: widget families. held-out-minimal: the same with only text/url checks (see preregistration.md).
const SETS = {
  seen: SCENARIOS,
  "held-out": WIDGET_SCENARIOS,
  "held-out-minimal": WIDGET_SCENARIOS_MINIMAL,
  independent: INDEPENDENT_SCENARIOS,
  multi: MULTI_SCENARIOS,
} as const;
const setName = arg("set", "seen") as keyof typeof SETS;
if (!(setName in SETS))
  throw new Error(`unknown --set ${setName}; use ${Object.keys(SETS).join(" | ")}`);
const pool = SETS[setName];
const scenarios = pool.filter(
  (s) => !scenarioFilter || scenarioFilter.some((f) => s.id.startsWith(f)),
);
const driverFactories = [...ALL_DRIVERS, ...SELENIUM_DRIVERS].filter((f) => {
  const id = f().id;
  // Selenium drivers run only when asked for by name.
  return driverFilter ? driverFilter.includes(id) : !id.startsWith("sel-");
});

interface Task {
  scenarioIdx: number;
  driverIdx: number;
  trial: number;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function git(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unavailable";
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const pwVersion = (
    JSON.parse(
      fs.readFileSync(new URL("../node_modules/playwright/package.json", import.meta.url), "utf8"),
    ) as { version: string }
  ).version;
  fs.writeFileSync(
    path.join(outDir, "env.json"),
    JSON.stringify(
      {
        runId,
        startedAt: new Date().toISOString(),
        node: process.version,
        playwright: pwVersion,
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model,
        trials,
        concurrency,
        drivers: driverFactories.map((f) => f().id),
        scenarios: scenarios.map((s) => s.id),
        gitHead: git("git rev-parse HEAD"),
        gitDirty: git("git status --porcelain").length > 0,
        note: "Scripted actors only; no LLM involved. See benchmarks/methodology.md.",
      },
      null,
      2,
    ),
  );

  // Task list interleaved and shuffled with a fixed seed to avoid order effects.
  const tasks: Task[] = [];
  for (let t = 0; t < trials; t++)
    for (let s = 0; s < scenarios.length; s++)
      for (let d = 0; d < driverFactories.length; d++)
        tasks.push({ scenarioIdx: s, driverIdx: d, trial: t });
  const rnd = mulberry32(12345);
  for (let i = tasks.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [tasks[i], tasks[j]] = [tasks[j]!, tasks[i]!];
  }

  const out = fs.createWriteStream(path.join(outDir, "trials.jsonl"));
  let done = 0;
  const queue = [...tasks];
  const started = Date.now();

  async function worker(wid: number) {
    const drivers = new Map<number, Driver>();
    for (;;) {
      const task = queue.pop();
      if (!task) break;
      const sc = scenarios[task.scenarioIdx]!;
      let driver = drivers.get(task.driverIdx);
      if (!driver) {
        driver = driverFactories[task.driverIdx]!();
        await driver.setup();
        drivers.set(task.driverIdx, driver);
      }
      const seed = task.trial + 1;
      const server = makeServer(sc, seed);
      const url = await server.start();
      const t0 = Date.now();
      let rec: TrialRecord;
      try {
        const outcome = await Promise.race([
          driver.run(sc, url),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("trial timeout")), TRIAL_TIMEOUT_MS),
          ),
        ]);
        const latencyMs = Date.now() - t0;
        const o = oracleSummary(sc, await server.oracle());
        const outcomeClass = classify(sc, outcome.claim, o.effect);
        rec = {
          runId,
          scenario: sc.id,
          kind: sc.kind,
          category: sc.category,
          driver: driver.id,
          trial: task.trial,
          seed,
          claim: outcome.claim,
          outcome: outcomeClass,
          effect: o.effect,
          duplicates: o.duplicates,
          postCount: o.postCount,
          latencyMs,
          browserActions: outcome.browserActions,
          observationChars: outcome.observationChars,
          recoveries: outcome.recoveries,
          maskedDefect: sc.kind === "defect" && outcome.claim === "pass" && outcome.recoveries > 0,
          diagnostic: outcome.diagnostic,
          notes: outcome.notes,
        };
      } catch (e) {
        const o = oracleSummary(sc, await server.oracle());
        rec = {
          runId,
          scenario: sc.id,
          kind: sc.kind,
          category: sc.category,
          driver: driver.id,
          trial: task.trial,
          seed,
          claim: "error",
          outcome: "driver_error",
          effect: o.effect,
          duplicates: o.duplicates,
          postCount: o.postCount,
          latencyMs: Date.now() - t0,
          browserActions: 0,
          observationChars: 0,
          recoveries: 0,
          maskedDefect: false,
          diagnostic: e instanceof Error ? e.message.slice(0, 300) : String(e),
        };
      } finally {
        await server.stop();
      }
      out.write(JSON.stringify(rec) + "\n");
      done++;
      if (done % 25 === 0 || done === tasks.length) {
        process.stderr.write(
          `[w${wid}] ${done}/${tasks.length} trials, ${Math.round((Date.now() - started) / 1000)}s\n`,
        );
      }
    }
    for (const d of drivers.values()) await d.teardown();
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  await new Promise<void>((r) => out.end(r));
  fs.appendFileSync(path.join(outDir, "env.json"), "");
  fs.writeFileSync(
    path.join(outDir, "finished.json"),
    JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        trials: done,
        wallSeconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      2,
    ),
  );
  process.stderr.write(`done: ${done} trials -> ${outDir}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
