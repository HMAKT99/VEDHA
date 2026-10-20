import { describe, expect, it } from "vitest";
import { locatorCode, promote } from "../src/promote.js";
import { parseSpecFile } from "../src/schema.js";
import { SCHEMAS } from "../src/types.js";
import type { ActionSpec, TestProposal } from "../src/types.js";

const btn = { role: "button", name: "Go" } as const;
const spec = (steps: unknown[]) => parseSpecFile({ steps });
const step = (op: string, extra: Record<string, unknown> = {}) => ({
  id: `s-${op}`,
  intent: op,
  op,
  ...extra,
});

describe("extended ops: validation", () => {
  it("accepts the new ops with the fields they need", () => {
    const parsed = spec([
      step("hover", { target: btn }),
      step("dblclick", { target: btn }),
      step("uncheck", { target: { label: "Agree" } }),
      step("upload", { target: { label: "File" }, value: "/data/a.txt" }),
      step("scroll"),
      step("scroll", { target: btn }),
      step("drag", { target: btn, to: { text: "Drop here" } }),
      step("wait", { value: "300" }),
      step("back"),
      step("reload"),
      step("switch_tab", { value: "last" }),
      step("click", { target: { inFrame: "iframe#pay", target: btn } }),
    ]);
    expect(parsed.steps).toHaveLength(12);
  });

  it("rejects ops missing what they need", () => {
    expect(() => spec([step("hover")])).toThrow(/requires a target/);
    expect(() => spec([step("drag", { target: btn })])).toThrow(/destination/);
    expect(() => spec([step("upload", { target: btn })])).toThrow(/file path/);
    expect(() => spec([step("teleport", { target: btn })])).toThrow();
  });

  it("accepts the dialog, upload and health policy fields", () => {
    const p = parseSpecFile({
      policy: { dialogs: "accept", uploadRoots: ["/data"], health: "all" },
      steps: [step("back")],
    });
    expect(p.policy?.uploadRoots).toEqual(["/data"]);
    expect(() => parseSpecFile({ policy: { dialogs: "maybe" }, steps: [step("back")] })).toThrow();
  });
});

describe("extended ops: promotion to a Playwright test", () => {
  const proposal = (steps: ActionSpec[]): TestProposal => ({
    schema: SCHEMAS.testProposal,
    title: "t",
    goal: "g",
    preconditions: [],
    steps,
    assertions: [],
    cleanup: [],
    evidence: [],
    confidence: 1,
    assumptions: [],
  });
  const mk = (op: ActionSpec["op"], extra: Partial<ActionSpec> = {}): ActionSpec => ({
    id: op,
    intent: op,
    op,
    ...extra,
  });

  it("emits code for every new op", () => {
    const code = promote(
      proposal([
        mk("hover", { target: btn }),
        mk("dblclick", { target: btn }),
        mk("uncheck", { target: { label: "Agree" } }),
        mk("upload", { target: { label: "File" }, value: "/data/a.txt" }),
        mk("scroll", { value: "bottom" }),
        mk("scroll", { target: btn }),
        mk("drag", { target: btn, to: { text: "Drop here" } }),
        mk("back"),
        mk("reload"),
      ]),
    );
    expect(code).toContain(".hover();");
    expect(code).toContain(".dblclick();");
    expect(code).toContain(".uncheck();");
    expect(code).toContain('.setInputFiles(["/data/a.txt"]);');
    expect(code).toContain("page.mouse.wheel(0, 100000)");
    expect(code).toContain(".scrollIntoViewIfNeeded();");
    expect(code).toContain('.dragTo(page.getByText("Drop here"))');
    expect(code).toContain("page.goBack()");
    expect(code).toContain("page.reload()");
  });

  it("targets elements inside an iframe with frameLocator", () => {
    expect(locatorCode({ inFrame: "iframe#pay", target: btn })).toBe(
      'page.frameLocator("iframe#pay").getByRole("button", { name: "Go" })',
    );
  });
});

describe("JUnit output", () => {
  it("maps verified, unverified, failed and unknown steps", async () => {
    const { toJUnit } = await import("../src/junit.js");
    const mk = (actionId: string, status: string, extra: object = {}) =>
      ({
        schema: SCHEMAS.actionResult,
        actionId,
        status,
        recovered: false,
        verdicts: [],
        recoveries: [],
        attempts: 1,
        durationMs: 10,
        ...extra,
      }) as never;
    const xml = toJUnit(
      {
        schema: SCHEMAS.runReport,
        verdict: "failed",
        steps: [
          mk("a", "verified"),
          mk("b", "unverified"),
          mk("c", "failed", {
            error: { code: "other", message: 'bad <value> & "quote"', hint: "try x" },
          }),
          mk("d", "outcome_unknown", { error: { code: "other", message: "unknown" } }),
          mk("e", "blocked", { error: { code: "repeat_refused", message: "refused" } }),
        ],
        durationMs: 50,
        browserActions: 5,
        observations: 0,
        observationChars: 0,
      },
      "suite & co",
    );
    expect(xml).toContain('tests="5" failures="2" skipped="1"');
    expect(xml).toContain('name="suite &amp; co"');
    expect(xml).toContain("bad &lt;value&gt; &amp; &quot;quote&quot;");
    expect(xml).toContain("hint: try x");
    expect(xml).toContain('<skipped message="no postcondition was declared"/>');
  });
});

describe("page header rendering", () => {
  it("shows tabs, a non-2xx main document and console problems, and nothing when all is normal", async () => {
    const { describeHeader } = await import("../src/feedback.js");
    expect(describeHeader(undefined)).toEqual([]);
    expect(
      describeHeader({
        tabs: [{ index: 0, url: "http://a/", title: "A", current: true }],
        mainStatus: 200,
        consoleErrors: 0,
        consoleWarnings: 0,
      }),
    ).toEqual([]);
    const lines = describeHeader({
      tabs: [
        { index: 0, url: "http://a/", title: "A", current: false },
        { index: 1, url: "http://a/r", title: "R", current: true },
      ],
      mainStatus: 404,
      consoleErrors: 2,
      consoleWarnings: 1,
    });
    expect(lines[0]).toContain("1 (current)");
    expect(lines).toContain("main document HTTP status: 404");
    expect(lines).toContain("console: 2 errors, 1 warnings");
  });
});
