import fs from "node:fs";
import path from "node:path";
import { launchBrowser } from "../drivers/common.js";
import { ShopServer } from "../fixtures/shop.js";
import { classify, oracleSummary } from "../harness/classify.js";
import { SCENARIOS } from "../scenarios/index.js";
import { runPlainArm, runVedhaArm, type ArmOutcome } from "./arms.js";
import { CostGuardError, Gateway } from "./gateway.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
}

/** Same natural-language task for every scenario; it never mentions defects or recovery. */
const GOAL =
  "On this shop app, place an order for customer 'Ada' with quantity 3. Call done with success=true only if the order was really placed.";

const model = arg("model", "minimax/minimax-m3.1-flash");
const provider = arg("provider", "minimax");
const trials = Number(arg("trials", "2"));
const maxCalls = Number(arg("max-calls", "250"));
const scenarioIds = arg("scenarios", "S01,S02,S03,S04,S06,S07,S09,S10").split(",");
const runId = arg("run-id", `llm-pilot-${new Date().toISOString().slice(0, 10)}`);
const outDir = path.resolve(`benchmarks/results/${runId}`);

/** A seeded defect only counts as detected when the order request was actually sent. */
function labelOutcome(sc: { category: string }, outcome: string, postCount: number): string {
  return sc.category === "seeded-defect" && outcome === "detected" && postCount === 0
    ? "detected_without_submit"
    : outcome;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const gw = new Gateway(model, provider, maxCalls);
  const browser = await launchBrowser();
  const scenarios = SCENARIOS.filter((s) => scenarioIds.some((id) => s.id.startsWith(id)));
  const arms = [
    { id: "llm-plain", run: runPlainArm },
    { id: "llm-vedha", run: runVedhaArm },
  ];
  fs.writeFileSync(
    path.join(outDir, "env.json"),
    JSON.stringify(
      {
        runId,
        model,
        provider,
        trials,
        maxCalls,
        scenarios: scenarios.map((s) => s.id),
        goal: GOAL,
        startedAt: new Date().toISOString(),
        note: "LLM pilot, single model, small N; see benchmarks/llm/README.md",
      },
      null,
      2,
    ),
  );
  const trialsOut = fs.createWriteStream(path.join(outDir, "trials.jsonl"));
  const transcripts = fs.createWriteStream(path.join(outDir, "transcripts.jsonl"));
  let stopped = "";
  outer: for (let t = 0; t < trials; t++) {
    for (const sc of scenarios) {
      for (const arm of arms) {
        const server = new ShopServer({ ...sc.variant, seed: t + 1 });
        const url = await server.start();
        const t0 = Date.now();
        let out: ArmOutcome | undefined;
        let error = "";
        try {
          out = await Promise.race([
            arm.run({ browser, gw, goal: GOAL, baseUrl: new URL(sc.startPath, url).toString() }),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("trial timeout")), 240_000),
            ),
          ]);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          if (e instanceof CostGuardError) stopped = error;
        }
        const o = oracleSummary(sc, await server.oracle());
        await server.stop();
        const claim = out?.claim ?? "error";
        const rec = {
          runId,
          scenario: sc.id,
          kind: sc.kind,
          driver: arm.id,
          trial: t,
          claim,
          outcome: out
            ? labelOutcome(sc, classify(sc, out.claim, o.effect), o.postCount)
            : "driver_error",
          effect: o.effect,
          duplicates: o.duplicates,
          postCount: o.postCount,
          latencyMs: Date.now() - t0,
          browserActions: out?.browserActions ?? 0,
          observationChars: out?.observationChars ?? 0,
          recoveries: out?.recoveries ?? 0,
          llmCalls: out?.llmCalls ?? 0,
          promptTokens: out?.promptTokens ?? 0,
          completionTokens: out?.completionTokens ?? 0,
          diagnostic: out?.diagnostic ?? error.slice(0, 300),
        };
        trialsOut.write(JSON.stringify(rec) + "\n");
        if (out)
          transcripts.write(
            JSON.stringify({
              scenario: sc.id,
              driver: arm.id,
              trial: t,
              messages: out.transcript,
            }) + "\n",
          );
        process.stderr.write(
          `${sc.id} ${arm.id} t${t}: ${rec.outcome} (calls ${rec.llmCalls}, tokens ${rec.promptTokens}+${rec.completionTokens})${error ? " ERR " + error.slice(0, 100) : ""}\n`,
        );
        if (stopped) break outer;
      }
    }
  }
  await browser.close();
  await new Promise<void>((r) => trialsOut.end(r));
  await new Promise<void>((r) => transcripts.end(r));
  fs.writeFileSync(
    path.join(outDir, "finished.json"),
    JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        gatewayCalls: gw.calls,
        promptTokens: gw.promptTokens,
        completionTokens: gw.completionTokens,
        stoppedBecause: stopped || null,
      },
      null,
      2,
    ),
  );
  process.stderr.write(`done -> ${outDir}${stopped ? "  STOPPED: " + stopped : ""}\n`);
}

void main();
