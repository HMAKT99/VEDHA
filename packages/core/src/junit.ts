import type { ActionResult, RunReport } from "./types.js";

const esc = (s: string): string =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );

/** One test case per step. verified = pass; failed, blocked and unknown outcomes = failure; unverified = skipped. */
function testcase(suite: string, r: ActionResult): string {
  const open = `<testcase classname="${esc(suite)}" name="${esc(r.actionId)}" time="${(r.durationMs / 1000).toFixed(3)}"`;
  const lines = [
    r.error ? `${r.error.code}: ${r.error.message}` : "",
    r.error?.hint ? `hint: ${r.error.hint}` : "",
    ...r.verdicts
      .filter((v) => v.status !== "pass" && !v.implicit)
      .map((v) => `check ${v.status}: ${v.detail}`),
    ...r.recoveries.map((x) => `recovery ${x.strategy} ${x.outcome}`),
  ].filter(Boolean);
  const body = esc(lines.join("\n"));
  switch (r.status) {
    case "verified":
      return `${open}>${r.recovered ? `<system-out>${body || "passed after recovery"}</system-out>` : ""}</testcase>`;
    case "unverified":
      return `${open}><skipped message="no postcondition was declared"/></testcase>`;
    default:
      return `${open}><failure type="${esc(r.status)}" message="${esc(r.error?.message ?? r.status)}">${body}</failure></testcase>`;
  }
}

/** JUnit XML for CI systems that read it (a refused repeat is listed but not counted as a failure). */
export function toJUnit(report: RunReport, suite: string): string {
  const steps = report.steps;
  const failures = steps.filter(
    (r) =>
      r.error?.code !== "repeat_refused" &&
      ["failed", "blocked", "outcome_unknown"].includes(r.status),
  ).length;
  const skipped = steps.filter((r) => r.status === "unverified").length;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites>`,
    `<testsuite name="${esc(suite)}" tests="${steps.length}" failures="${failures}" skipped="${skipped}" time="${(report.durationMs / 1000).toFixed(3)}">`,
    ...steps.map((r) => testcase(suite, r)),
    `</testsuite>`,
    `</testsuites>`,
    ``,
  ].join("\n");
}
