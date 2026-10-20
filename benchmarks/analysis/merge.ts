/**
 * Builds a combined run directory from valid parts of several runs, without altering the sources.
 * Usage: tsx benchmarks/analysis/merge.ts <out-dir> <src-dir>:<driver,driver|*> [<src-dir>:<drivers> ...]
 * Example: merge.ts results/heldout-n20-final results/heldout-n20:pw-trust,pw-test results/heldout-n20-sel:sel-trust,sel-strong
 * The combined env.json lists each source and which drivers were taken from it.
 */
import fs from "node:fs";
import path from "node:path";

const [outArg, ...parts] = process.argv.slice(2);
if (!outArg || !parts.length) throw new Error("usage: merge.ts <out-dir> <src-dir>:<drivers> ...");
const out = path.resolve(outArg);
fs.mkdirSync(out, { recursive: true });

const rows: string[] = [];
const sources: Array<{ dir: string; drivers: string[] | "*"; rows: number; env: unknown }> = [];
for (const p of parts) {
  const [dir, drv = "*"] = p.split(":");
  const wanted = drv === "*" ? "*" : drv.split(",");
  const lines = fs
    .readFileSync(path.join(path.resolve(dir!), "trials.jsonl"), "utf8")
    .trim()
    .split("\n");
  const kept = lines.filter(
    (l) => wanted === "*" || wanted.includes((JSON.parse(l) as { driver: string }).driver),
  );
  rows.push(...kept);
  sources.push({
    dir: path.relative(process.cwd(), path.resolve(dir!)),
    drivers: wanted,
    rows: kept.length,
    env: JSON.parse(fs.readFileSync(path.join(path.resolve(dir!), "env.json"), "utf8")),
  });
}
fs.writeFileSync(path.join(out, "trials.jsonl"), rows.join("\n") + "\n");
const first = sources[0]!.env as Record<string, unknown>;
const drivers = [...new Set(rows.map((l) => (JSON.parse(l) as { driver: string }).driver))];
fs.writeFileSync(
  path.join(out, "env.json"),
  JSON.stringify(
    { ...first, drivers, merged: true, sources: sources.map(({ env: _env, ...s }) => s) },
    null,
    2,
  ),
);
process.stderr.write(`merged ${rows.length} trials from ${sources.length} runs -> ${out}\n`);
