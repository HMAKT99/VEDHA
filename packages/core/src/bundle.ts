import fs from "node:fs";
import path from "node:path";
import { redactDeep, resolveInside } from "./policy.js";
import type { Session } from "./session.js";
import { SCHEMAS } from "./types.js";
import type { ActionResult, FailureBundle } from "./types.js";

export const VEDHA_VERSION = "0.1.0";

/** Captures goal, steps, verdicts, recovery records, network and trace into one bundle. */
export function createBundle(
  session: Session,
  goal: string,
  adapterVersion?: string,
): FailureBundle {
  const report = session.report();
  const reasons = [
    "replay re-contacts the live application: server state, time and external services are not restored",
  ];
  if (report.verdict === "outcome_unknown") {
    reasons.push("original run ended with outcome_unknown; replay may duplicate side effects");
  }
  if (!session.startUrl) reasons.push("no initial goto step recorded");
  const secrets = session.policy.secrets ?? [];
  return redactDeep(
    {
      schema: SCHEMAS.failureBundle,
      goal,
      createdAt: new Date().toISOString(),
      env: {
        vedha: VEDHA_VERSION,
        node: process.version,
        adapter: session.adapter.name,
        adapterVersion: adapterVersion ?? session.adapter.version,
      },
      startUrl: session.startUrl,
      steps: session.specs,
      report,
      network: session.adapter
        .networkLog()
        .map((n) => ({ method: n.method, url: n.url, status: n.status })),
      trace: session.trace.events,
      replay: { replayable: !!session.startUrl && report.verdict !== "outcome_unknown", reasons },
    } satisfies FailureBundle,
    secrets,
  );
}

export async function writeBundle(
  dir: string,
  bundle: FailureBundle,
  screenshot?: Uint8Array,
): Promise<string> {
  const out = path.resolve(dir);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(resolveInside(out, "bundle.json"), JSON.stringify(bundle, null, 2));
  fs.writeFileSync(
    resolveInside(out, "trace.ndjson"),
    bundle.trace.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  if (screenshot) fs.writeFileSync(resolveInside(out, "screenshot.png"), screenshot);
  return out;
}

export function readBundle(dir: string): FailureBundle {
  const file = resolveInside(path.resolve(dir), "bundle.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as FailureBundle;
  if (parsed.schema !== SCHEMAS.failureBundle) {
    throw new Error(`unsupported bundle schema: ${String(parsed.schema)}`);
  }
  return parsed;
}

export interface Divergence {
  actionId: string;
  original: ActionResult["status"];
  replayed: ActionResult["status"];
}

/** Re-drives the recorded steps in a fresh session and reports where outcomes differ. */
export async function replayBundle(
  session: Session,
  bundle: FailureBundle,
): Promise<{
  divergences: Divergence[];
  report: ReturnType<Session["report"]>;
  reasons: string[];
}> {
  for (const spec of bundle.steps) {
    const r = await session.step(spec);
    if (r.status === "blocked") break;
    // continue through failures so the full divergence picture is visible, except after a failed step
    if (r.status === "failed" || r.status === "outcome_unknown") break;
  }
  const divergences: Divergence[] = [];
  const replayed = session.results;
  for (let i = 0; i < bundle.report.steps.length; i++) {
    const o = bundle.report.steps[i]!;
    const r = replayed[i];
    if (!r) {
      divergences.push({ actionId: o.actionId, original: o.status, replayed: "blocked" });
    } else if (r.status !== o.status) {
      divergences.push({ actionId: o.actionId, original: o.status, replayed: r.status });
    }
  }
  return { divergences, report: session.report(), reasons: bundle.replay.reasons };
}
