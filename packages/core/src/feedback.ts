import { renderControls } from "./observation.js";
import type { ActionResult, Observation, PageHeader } from "./types.js";

/** Largest page view handed to an actor; beyond this the controls list replaces the outline. */
export const FEEDBACK_VIEW_CHARS = 6000;

/**
 * What an actor should read about the page: the full outline while it is complete, the interactive
 * controls once the outline had to be truncated (so large pages stay bounded), and the observation
 * text as-is for controls/region/detail levels or when the caller asked for a delta.
 */
export function pageView(obs: Observation, mode: "auto" | "text" = "auto"): string {
  if (mode === "text" || obs.level !== "outline") return obs.text;
  if (!obs.truncated && obs.outline.length <= FEEDBACK_VIEW_CHARS) return obs.outline;
  const shown = renderControls(obs.controls);
  const note = "(outline too large; showing interactive controls only)";
  return `${note}\n${shown.length > FEEDBACK_VIEW_CHARS ? shown.slice(0, FEEDBACK_VIEW_CHARS) + "\n- …" : shown}`;
}

/** What changed on the page since the previous observation, without refs, capped. */
export function describeChanges(obs: Observation): string[] {
  const d = obs.delta;
  if (!d || (!d.added.length && !d.removed.length)) return [];
  const clean = (l: string) =>
    l
      .replace(/\s*\[(?:ref|active|cursor)[^\]]*\]/g, "")
      .replace(/^\s*-\s*/, "")
      .slice(0, 120);
  const lines = [
    ...d.added.slice(0, 6).map((l) => `+ ${clean(l)}`),
    ...d.removed.slice(0, 4).map((l) => `- ${clean(l)}`),
  ];
  const more = d.added.length + d.removed.length - lines.length;
  return [
    `changed on the page (${d.added.length} added, ${d.removed.length} removed):`,
    ...lines.map((l) => `  ${l}`),
    ...(more > 0 ? [`  ... ${more} more`] : []),
  ];
}

/** Only what is notable: several tabs, a non-2xx main document, console problems. */
export function describeHeader(h: PageHeader | undefined): string[] {
  if (!h) return [];
  const out: string[] = [];
  if (h.tabs.length > 1)
    out.push(
      `tabs: ${h.tabs.map((t) => `${t.index}${t.current ? " (current)" : ""} ${t.title ? JSON.stringify(t.title.slice(0, 40)) + " " : ""}${t.url}`).join(" | ")}`,
    );
  if (h.mainStatus !== undefined && (h.mainStatus < 200 || h.mainStatus >= 300))
    out.push(`main document HTTP status: ${h.mainStatus}`);
  if (h.consoleErrors || h.consoleWarnings)
    out.push(`console: ${h.consoleErrors} errors, ${h.consoleWarnings} warnings`);
  return out;
}

/** One line per fact; failed checks, hints and recoveries are never omitted. */
export function describeResult(r: ActionResult): string[] {
  const lines = [`result: ${r.status}${r.error ? ` (${r.error.code}): ${r.error.message}` : ""}`];
  if (r.error?.hint) lines.push(`hint: ${r.error.hint}`);
  for (const v of r.verdicts)
    if (v.status !== "pass" && !v.implicit) lines.push(`check ${v.status}: ${v.detail}`);
  for (const v of r.verdicts)
    if (v.status !== "pass" && v.implicit) lines.push(`read-back ${v.status}: ${v.detail}`);
  for (const rec of r.recoveries)
    lines.push(
      `recovery ${rec.strategy} ${rec.outcome} (original: ${rec.originalError.code}: ${rec.originalError.message})`,
    );
  if (r.status === "unverified")
    lines.push("no postcondition was declared, so the effect is unchecked");
  if (r.requests?.length) lines.push(`requests: ${r.requests.join(", ")}`);
  for (const rb of r.readback ?? []) lines.push(rb);
  for (const o of r.observed ?? []) lines.push(`observed: ${o}`);
  if (r.note) lines.push(`note: ${r.note}`);
  return lines;
}

/** Shared by every actor and tool server so models see the same compact, bounded feedback. */
export function renderFeedback(
  last: ActionResult | undefined,
  obs: Observation,
  opts: { mode?: "auto" | "text"; changes?: boolean } = {},
): string {
  const head = last ? describeResult(last) : [];
  return [
    ...head,
    `url: ${obs.url}`,
    ...describeHeader(obs.header),
    ...(opts.changes ? describeChanges(obs) : []),
    "page:",
    pageView(obs, opts.mode),
  ].join("\n");
}
