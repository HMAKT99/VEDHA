import fs from "node:fs";
import path from "node:path";
import { PlaywrightAdapter, runGeneratedSpecRepeated } from "@vedha/adapter-playwright";
import {
  RuleActor,
  Session,
  createBundle,
  explore,
  jsonSchemas,
  parseSpecFile,
  promote,
  readBundle,
  replayBundle,
  resolveInside,
  toJUnit,
  writeBundle,
} from "@vedha/core";
import type { Policy, RunVerdict, TestProposal } from "@vedha/core";
import { flag, flagAll, has, parseArgs, type Parsed } from "./args.js";

export const EXIT: Record<RunVerdict, number> = {
  passed: 0,
  passed_with_recovery: 0,
  failed: 1,
  blocked: 2,
  outcome_unknown: 4,
  unverified: 5,
};

const HELP = `vedha - verified, agent-friendly browser testing

Usage:
  vedha run <spec.json> [--base-url URL] [--allow-domain HOST]... [--out DIR] [--junit FILE.xml] [--headed]
  vedha observe <url> [--allow-domain HOST]... [--max-chars N]
  vedha explore <goal.json> --start-url URL [--promote FILE.spec.ts] [--check BASE_URL [--repeat N]] [--out DIR]
  vedha promote <proposal.json> --out FILE.spec.ts [--check BASE_URL [--repeat N]]
  vedha replay <bundle-dir> [--base-url URL]
  vedha schemas [--out DIR]
  vedha doctor

Exit codes: 0 passed(_with_recovery) | 1 failed | 2 blocked by policy | 3 error | 4 outcome_unknown | 5 unverified
All output is JSON on stdout; diagnostics go to stderr. Page content is treated as untrusted data.`;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function policyFrom(p: Parsed, base?: Policy): Policy {
  const allowed = [...(base?.allowedDomains ?? []), ...flagAll(p, "allow-domain")];
  return {
    ...base,
    allowedDomains: allowed.length ? allowed : undefined,
    approveDestructive: has(p, "approve-destructive") ? true : base?.approveDestructive,
  };
}

function out(obj: unknown) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

async function cmdRun(p: Parsed): Promise<number> {
  const file = p.positional[0];
  if (!file) throw new Error("run requires <spec.json>");
  const spec = parseSpecFile(readJson(file));
  const base = flag(p, "base-url");
  const policy = policyFrom(p, spec.policy);
  if (base && !policy.allowedDomains) policy.allowedDomains = [new URL(base).hostname];
  const adapter = await PlaywrightAdapter.launch({ headless: !has(p, "headed") });
  const session = await Session.create(adapter, policy);
  try {
    const steps = spec.steps.map((s) =>
      s.op === "goto" && base ? { ...s, value: new URL(s.value ?? "/", base).toString() } : s,
    );
    const report = await session.run(steps);
    const outDir = flag(p, "out");
    if (outDir && report.verdict !== "passed") {
      const bundle = createBundle(session, spec.goal ?? path.basename(file));
      await writeBundle(outDir, bundle, await adapter.screenshot());
      process.stderr.write(`failure bundle written to ${path.resolve(outDir)}\n`);
    }
    const junit = flag(p, "junit");
    if (junit)
      fs.writeFileSync(path.resolve(junit), toJUnit(report, spec.goal ?? path.basename(file)));
    out(report);
    return EXIT[report.verdict];
  } finally {
    await session.close();
  }
}

async function cmdObserve(p: Parsed): Promise<number> {
  const url = p.positional[0];
  if (!url) throw new Error("observe requires <url>");
  const policy = policyFrom(p, {
    maxObservationChars: flag(p, "max-chars") ? Number(flag(p, "max-chars")) : undefined,
  });
  const session = await Session.create(await PlaywrightAdapter.launch(), policy);
  try {
    const r = await session.step({ id: "open", intent: "open page", op: "goto", value: url });
    if (r.status === "blocked" || r.status === "failed") {
      out(r);
      return r.status === "blocked" ? 2 : 1;
    }
    out(await session.observe());
    return 0;
  } finally {
    await session.close();
  }
}

async function cmdExplore(p: Parsed): Promise<number> {
  const file = p.positional[0];
  const start = flag(p, "start-url");
  if (!file || !start) throw new Error("explore requires <goal.json> and --start-url");
  const g = readJson(file) as {
    goal: string;
    fields: Array<{ name: string; value: string; role: "textbox" | "spinbutton" | "combobox" }>;
    submit: { name: string; mutating: boolean; postconditions: unknown[]; reconcile?: unknown };
  };
  // Validate postconditions with the same schema used for specs (reuse by wrapping in a probe step).
  const probe = parseSpecFile({
    steps: [
      {
        id: "probe",
        intent: "probe",
        op: "click",
        target: { role: "button" },
        postconditions: g.submit.postconditions,
        reconcile: g.submit.reconcile,
      },
    ],
  }).steps[0]!;
  const policy = policyFrom(p, { allowedDomains: [new URL(start).hostname] });
  const session = await Session.create(await PlaywrightAdapter.launch(), policy);
  try {
    const actor = new RuleActor({
      fields: g.fields.map((f) => ({
        name: new RegExp(f.name, "i"),
        value: f.value,
        role: f.role,
      })),
      submit: {
        name: new RegExp(g.submit.name, "i"),
        mutating: g.submit.mutating,
        postconditions: probe.postconditions ?? [],
        reconcile: probe.reconcile,
      },
    });
    const res = await explore(session, actor, { goal: g.goal, startUrl: start });
    const outDir = flag(p, "out");
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        resolveInside(outDir, "proposal.json"),
        JSON.stringify(res.proposal, null, 2),
      );
    }
    const specFile = flag(p, "promote");
    if (specFile) {
      const code = promote(res.proposal, { baseUrl: start });
      fs.writeFileSync(path.resolve(specFile), code);
      const check = flag(p, "check");
      if (check)
        res.proposal.replayCheck = await runGeneratedSpecRepeated(
          code,
          check,
          path.resolve(".vedha", "replay-check"),
          Math.max(1, Number(flag(p, "repeat") ?? "1")),
        );
    }
    out(res);
    return res.proposal.replayCheck && !res.proposal.replayCheck.passed
      ? 1
      : EXIT[session.report().verdict];
  } finally {
    await session.close();
  }
}

async function cmdPromote(p: Parsed): Promise<number> {
  const file = p.positional[0];
  const dest = flag(p, "out");
  if (!file || !dest) throw new Error("promote requires <proposal.json> and --out");
  const proposal = readJson(file) as TestProposal;
  if (proposal.schema !== "vedha.test-proposal/v1")
    throw new Error(`unsupported proposal schema: ${String(proposal.schema)}`);
  const code = promote(proposal);
  fs.writeFileSync(path.resolve(dest), code);
  const check = flag(p, "check");
  if (check) {
    const res = await runGeneratedSpecRepeated(
      code,
      check,
      path.resolve(".vedha", "replay-check"),
      Math.max(1, Number(flag(p, "repeat") ?? "1")),
    );
    out(res);
    return res.passed ? 0 : 1;
  }
  out({ written: path.resolve(dest) });
  return 0;
}

async function cmdReplay(p: Parsed): Promise<number> {
  const dir = p.positional[0];
  if (!dir) throw new Error("replay requires <bundle-dir>");
  const bundle = readBundle(dir);
  const base = flag(p, "base-url");
  const start = base ?? bundle.startUrl;
  const policy = policyFrom(p, start ? { allowedDomains: [new URL(start).hostname] } : {});
  const session = await Session.create(await PlaywrightAdapter.launch(), policy);
  try {
    const steps = bundle.steps.map((s) =>
      s.op === "goto" && base
        ? {
            ...s,
            value: new URL(new URL(s.value ?? "/", bundle.startUrl).pathname, base).toString(),
          }
        : s,
    );
    const res = await replayBundle(session, { ...bundle, steps });
    out({ divergences: res.divergences, verdict: res.report.verdict, caveats: res.reasons });
    return res.divergences.length ? 1 : 0;
  } finally {
    await session.close();
  }
}

async function cmdSchemas(p: Parsed): Promise<number> {
  const schemas = jsonSchemas();
  const dest = flag(p, "out");
  if (dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const [name, schema] of Object.entries(schemas)) {
      fs.writeFileSync(
        resolveInside(dest, name.replace(/[^a-z0-9.-]/gi, "_") + ".json"),
        JSON.stringify(schema, null, 2),
      );
    }
  }
  out(Object.keys(schemas));
  return 0;
}

async function cmdDoctor(): Promise<number> {
  const checks: Record<string, unknown> = {
    node: process.version,
    nodeOk: Number(process.versions.node.split(".")[0]) >= 20,
  };
  try {
    const adapter = await PlaywrightAdapter.launch();
    checks.browser = adapter.version;
    await adapter.close();
    checks.browserOk = true;
  } catch (e) {
    checks.browserOk = false;
    checks.browserError = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    checks.hint = "run: npx playwright install chromium";
  }
  out(checks);
  return checks.nodeOk && checks.browserOk ? 0 : 3;
}

export async function main(argv: string[]): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 3;
  }
  if (has(parsed, "help") || ["help", "--help", "-h"].includes(parsed.command)) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  try {
    switch (parsed.command) {
      case "run":
        return await cmdRun(parsed);
      case "observe":
        return await cmdObserve(parsed);
      case "explore":
        return await cmdExplore(parsed);
      case "promote":
        return await cmdPromote(parsed);
      case "replay":
        return await cmdReplay(parsed);
      case "schemas":
        return await cmdSchemas(parsed);
      case "doctor":
        return await cmdDoctor();
      default:
        process.stderr.write(`unknown command: ${parsed.command}\n\n${HELP}\n`);
        return 3;
    }
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 3;
  }
}
