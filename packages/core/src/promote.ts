import type { Session } from "./session.js";
import { isRegexLiteral } from "./verifiers.js";
import { SCHEMAS } from "./types.js";
import type { ActionSpec, TestProposal, Target, Verifier } from "./types.js";

const q = (s: string) => JSON.stringify(s);

/** Playwright locator source for a Target. Refs are per-snapshot and cannot be promoted. */
export function locatorCode(t: Target, base = "page"): string {
  if ("within" in t) return locatorCode(t.target, locatorCode(t.within, base));
  if ("role" in t) {
    const opts = [
      t.name !== undefined ? `name: ${q(t.name)}` : "",
      t.exact ? "exact: true" : "",
    ].filter(Boolean);
    return `${base}.getByRole(${q(t.role)}${opts.length ? `, { ${opts.join(", ")} }` : ""})`;
  }
  if ("testId" in t) return `${base}.getByTestId(${q(t.testId)})`;
  if ("label" in t) return `${base}.getByLabel(${q(t.label)}${t.exact ? ", { exact: true }" : ""})`;
  if ("text" in t) return `${base}.getByText(${q(t.text)}${t.exact ? ", { exact: true }" : ""})`;
  throw new Error("ref targets are valid for one snapshot only and cannot be promoted to a test");
}

function hasRef(t: Target | undefined): boolean {
  if (!t) return false;
  if ("within" in t) return hasRef(t.within) || hasRef(t.target);
  return "ref" in t;
}

/** Builds a reviewable proposal from a finished (or partial) session. */
export function proposalFromSession(
  session: Session,
  opts: {
    title: string;
    goal: string;
    preconditions?: string[];
    finalAssertions?: Verifier[];
    cleanup?: ActionSpec[];
  },
): TestProposal {
  const assumptions: string[] = [];
  const evidence: string[] = [];
  const steps: ActionSpec[] = [];
  let verified = 0;
  let penalty = 0;
  session.specs.forEach((spec, i) => {
    const r = session.results[i];
    if (!r) return;
    if (r.status !== "verified" && r.status !== "unverified") {
      assumptions.push(`step ${spec.id} ended ${r.status}; excluded from the proposal`);
      return;
    }
    const used: ActionSpec = { ...spec, target: r.usedTarget ?? spec.target };
    if (hasRef(used.target)) {
      assumptions.push(
        `step ${spec.id} used a snapshot ref; replace with a durable locator before promoting`,
      );
    }
    if (r.status === "unverified")
      assumptions.push(`step ${spec.id} had no postcondition (unverified)`);
    if (r.recovered) {
      penalty += 0.1;
      assumptions.push(
        `step ${spec.id} only succeeded after recovery (${r.recoveries.map((x) => x.strategy).join(", ")}); the locator in the proposal is the one that worked`,
      );
    }
    if (r.status === "verified") verified++;
    for (const v of r.verdicts)
      evidence.push(`${spec.id}: ${v.verifier.type} ${v.status} - ${v.detail}`);
    steps.push(used);
  });
  const total = Math.max(1, session.results.length);
  return {
    schema: SCHEMAS.testProposal,
    title: opts.title,
    goal: opts.goal,
    preconditions: opts.preconditions ?? [],
    steps,
    assertions: opts.finalAssertions ?? [],
    cleanup: opts.cleanup ?? [],
    evidence,
    confidence: Math.max(0, Math.round((verified / total - penalty) * 100) / 100),
    assumptions,
  };
}

function expectLines(v: Verifier, indent: string): string[] {
  const L = (s: string) => indent + s;
  switch (v.type) {
    case "text": {
      const loc = v.target ? locatorCode(v.target) : `page.locator("body")`;
      return [
        v.equals !== undefined
          ? L(`await expect(${loc}).toHaveText(${q(v.equals)});`)
          : L(`await expect(${loc}).toContainText(${q(v.contains ?? "")});`),
      ];
    }
    case "value":
      return [L(`await expect(${locatorCode(v.target)}).toHaveValue(${q(v.equals)});`)];
    case "state": {
      const loc = locatorCode(v.target);
      const m = {
        visible: "toBeVisible",
        hidden: "toBeHidden",
        enabled: "toBeEnabled",
        disabled: "toBeDisabled",
        checked: "toBeChecked",
      }[v.state];
      return [L(`await expect(${loc}).${m}();`)];
    }
    case "url": {
      const escaped = v.matches.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const pat = isRegexLiteral(v.matches) ? v.matches : `/${escaped}/`;
      return [L(`await expect(page).toHaveURL(${pat});`)];
    }
    case "api":
      return [
        L(`await expect.poll(async () => {`),
        L(`  const res = await page.request.get(${q(v.get)});`),
        L(`  const body = await res.json();`),
        L(`  const items = Array.isArray(body) ? body : [body];`),
        L(
          `  return items.some((it) => Object.entries(${JSON.stringify(v.matchesAny)}).every(([k, val]) => it[k] === val));`,
        ),
        L(`}).toBe(true);`),
      ];
    case "network":
      return []; // handled around the action (needs waitForResponse before the input)
  }
}

function actionLine(s: ActionSpec, indent: string, origin?: string): string {
  const loc = s.target ? locatorCode(s.target) : "";
  switch (s.op) {
    case "goto":
      return `${indent}await page.goto(${q(relativize(s.value ?? "/", origin))});`;
    case "click":
      return `${indent}await ${loc}.click();`;
    case "fill":
      return `${indent}await ${loc}.fill(${q(s.value ?? "")});`;
    case "select":
      return `${indent}await ${loc}.selectOption(${q(s.value ?? "")});`;
    case "check":
      return `${indent}await ${loc}.check();`;
    case "press":
      return `${indent}await ${loc ? loc + "." : "page.keyboard."}press(${q(s.value ?? "")});`;
  }
}

/** Same-origin absolute URLs become paths so the test runs against any baseURL. */
function relativize(value: string, origin?: string): string {
  try {
    const u = new URL(value);
    return origin && u.origin === origin ? u.pathname + u.search : value;
  } catch {
    return value;
  }
}

function stepCode(s: ActionSpec, n: number, indent: string, origin?: string): string[] {
  const I = indent + "  ";
  const lines: string[] = [`${indent}await test.step(${q(s.intent)}, async () => {`];
  const nets = (s.postconditions ?? []).filter(
    (v): v is Extract<Verifier, { type: "network" }> => v.type === "network",
  );
  nets.forEach((v, i) => {
    lines.push(
      `${I}const resp${n}_${i} = page.waitForResponse((r) => r.url().includes(${q(v.urlPattern)})${v.method ? ` && r.request().method() === ${q(v.method.toUpperCase())}` : ""});`,
    );
  });
  lines.push(actionLine(s, I, origin));
  nets.forEach((v, i) => {
    lines.push(`${I}const r${n}_${i} = await resp${n}_${i};`);
    if (v.status === "2xx" || v.status === undefined)
      lines.push(`${I}expect(r${n}_${i}.ok()).toBe(true);`);
    else lines.push(`${I}expect(r${n}_${i}.status()).toBe(${v.status});`);
    if (v.json) {
      const acc = v.json.path
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean)
        .map((p) => `[${/^\d+$/.test(p) ? p : q(p)}]`)
        .join("");
      lines.push(
        `${I}expect((await r${n}_${i}.json())${acc}).toEqual(${JSON.stringify(v.json.equals)});`,
      );
    }
  });
  for (const v of s.postconditions ?? []) lines.push(...expectLines(v, I));
  lines.push(`${indent}});`);
  return lines;
}

/** Renders a standalone Playwright Test spec. Set BASE_URL (or use `use.baseURL`) when running it. */
export function promote(p: TestProposal, opts: { baseUrl?: string } = {}): string {
  const firstGoto = p.steps.find((s) => s.op === "goto" && /^https?:/.test(s.value ?? ""));
  const origin = opts.baseUrl
    ? new URL(opts.baseUrl).origin
    : firstGoto
      ? new URL(firstGoto.value!).origin
      : undefined;
  const out: string[] = [
    `// Generated by Vedha from an explored session. Review before committing.`,
    `// goal: ${p.goal.replace(/\n/g, " ")}`,
    `// confidence: ${p.confidence}`,
    ...p.assumptions.map((a) => `// ASSUMPTION: ${a.replace(/\n/g, " ")}`),
    `import { test, expect } from "@playwright/test";`,
    ``,
    `test(${q(p.title)}, async ({ page }) => {`,
  ];
  p.steps.forEach((s, i) => out.push(...stepCode(s, i, "  ", origin)));
  if (p.assertions.length) {
    out.push(`  await test.step("final assertions", async () => {`);
    for (const v of p.assertions) out.push(...expectLines(v, "    "));
    out.push(`  });`);
  }
  p.cleanup.forEach((s, i) => out.push(...stepCode(s, 100 + i, "  ", origin)));
  out.push(`});`, ``);
  return out.join("\n");
}
