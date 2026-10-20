import fs from "node:fs";
import path from "node:path";

/**
 * Diagnostic quality: of the defect trials a driver detected, how many failure messages name the cause (an HTTP
 * status, a missing item in a read-back, a page error) rather than only an unmet check or a timeout.
 * A regex over the recorded `diagnostic` field, so it measures what a reader sees first, not whether it is right.
 *
 *   tsx benchmarks/analysis/diagnostics.ts benchmarks/results/<run>/trials.jsonl ...
 */
const CAUSE =
  /\b[45]\d\d\b|status \d{3}|returned \d{3}|page error|uncaught|no item in|did not show|read-back|reading .* back/i;

const byDriver = new Map<string, { detected: number; named: number }>();
for (const file of process.argv.slice(2)) {
  for (const line of fs.readFileSync(path.resolve(file), "utf8").trim().split("\n")) {
    const r = JSON.parse(line) as { driver: string; outcome: string; diagnostic?: string };
    if (r.outcome !== "detected") continue;
    const c = byDriver.get(r.driver) ?? { detected: 0, named: 0 };
    c.detected++;
    if (CAUSE.test(r.diagnostic ?? "")) c.named++;
    byDriver.set(r.driver, c);
  }
}
for (const [d, c] of [...byDriver].sort())
  console.log(
    `${d.padEnd(14)} detected ${String(c.detected).padStart(4)}  names cause ${String(c.named).padStart(4)} (${((100 * c.named) / c.detected).toFixed(0)}%)`,
  );
