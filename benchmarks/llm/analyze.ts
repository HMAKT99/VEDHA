/**
 * Summarises an LLM run (trials.jsonl from mcp-pilot.ts or run-pilot.ts) per arm, applying the
 * decision rule from benchmarks/preregistration.md. Usage: tsx benchmarks/llm/analyze.ts <run-dir>
 */
import fs from "node:fs";
import path from "node:path";
import { wilson } from "../analysis/stats.js";

interface Row {
  scenario: string;
  kind: "effect" | "defect";
  driver: string;
  outcome: string;
  postCount: number;
  duplicates: number;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  toolResultChars?: number;
  vedhaVerdict?: string;
}

const dir = path.resolve(process.argv[2] ?? "");
const rows: Row[] = fs
  .readFileSync(path.join(dir, "trials.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Row);

const arms = [...new Set(rows.map((r) => r.driver))];
const f = (k: number, n: number): string => {
  if (n === 0) return "-";
  const [lo, hi] = wilson(k, n);
  return `${k}/${n} (${Math.round((100 * k) / n)}%, CI ${Math.round(100 * lo)}-${Math.round(100 * hi)}%)`;
};

const out: string[] = [`# LLM run summary: ${path.basename(dir)}`, ""];
const stats: Record<
  string,
  { comp: [number, number]; fp: [number, number]; detSub: [number, number]; unc: [number, number] }
> = {};

out.push(
  "| arm | completion (healthy) | false-pass | detected with submit (defects) | uncertain | median tokens/trial | errors |",
  "| --- | --- | --- | --- | --- | --- | --- |",
);
for (const a of arms) {
  const mine = rows.filter((r) => r.driver === a);
  const healthy = mine.filter((r) => r.kind === "effect");
  const defects = mine.filter((r) => r.kind === "defect");
  const comp: [number, number] = [
    healthy.filter((r) => r.outcome === "success").length,
    healthy.length,
  ];
  const fpCount = mine.filter((r) => r.outcome === "false_pass" || r.outcome === "missed").length;
  const fp: [number, number] = [fpCount, mine.length];
  const detSub: [number, number] = [
    defects.filter((r) => r.outcome === "detected").length,
    defects.length,
  ];
  const unc: [number, number] = [
    mine.filter((r) => r.outcome.startsWith("uncertain")).length,
    mine.length,
  ];
  const tokens = mine.map((r) => r.promptTokens + r.completionTokens).sort((x, y) => x - y);
  const med = tokens.length ? tokens[Math.floor(tokens.length / 2)] : 0;
  stats[a] = { comp, fp, detSub, unc };
  out.push(
    `| ${a} | ${f(...comp)} | ${f(...fp)} | ${f(...detSub)} | ${f(...unc)} | ${med} | ${mine.filter((r) => r.outcome === "driver_error").length} |`,
  );
}

out.push(
  "",
  "## Per scenario",
  "",
  `| scenario | ${arms.join(" | ")} |`,
  `| --- | ${arms.map(() => "---").join(" | ")} |`,
);
for (const s of [...new Set(rows.map((r) => r.scenario))].sort()) {
  out.push(
    `| ${s} | ${arms
      .map((a) =>
        rows
          .filter((r) => r.scenario === s && r.driver === a)
          .map((r) => r.outcome)
          .join(", "),
      )
      .join(" | ")} |`,
  );
}

const v = arms.find((a) => a.includes("vedha"));
if (v) {
  out.push("", "## Pre-registered decision rule", "");
  for (const a of arms.filter((x) => x !== v)) {
    const sv = stats[v]!;
    const sa = stats[a]!;
    const rate = (x: [number, number]) => (x[1] ? x[0] / x[1] : NaN);
    const compOk = rate(sv.comp) >= rate(sa.comp) - 0.05;
    const [vLo, vHi] = wilson(...sv.fp);
    const [aLo, aHi] = wilson(...sa.fp);
    const fpBetter = rate(sv.fp) < rate(sa.fp) && vHi < aLo;
    const n = Math.min(sv.comp[1], sa.comp[1]);
    out.push(
      `- ${v} vs ${a}: completion not lower (within 5 points): **${compOk ? "yes" : "no"}**; false-pass lower with non-overlapping CIs: **${fpBetter ? "yes" : "no"}** (${f(...sv.fp)} vs ${f(...sa.fp)}); per-cell N is small (${n} healthy trials), so a "better" verdict is only an indication.`,
    );
    void vLo;
    void aHi;
  }
}
fs.writeFileSync(path.join(dir, "summary.md"), out.join("\n") + "\n");
process.stdout.write(out.join("\n") + "\n");
