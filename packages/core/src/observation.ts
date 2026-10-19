import type { BrowserAdapter } from "./adapter.js";
import { SCHEMAS } from "./types.js";
import type { Control, Observation, ObservationLevel } from "./types.js";

export const DEFAULT_MAX_OBSERVATION_CHARS = 6000;

const INTERACTIVE = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "spinbutton",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "tab",
  "menuitem",
  "option",
  "heading",
  "dialog",
  "alert",
  "status",
]);
const MAX_CONTROLS = 150;

export interface OutlineEntry {
  ref: string;
  role: string;
  name?: string;
  line: string;
}

/** Parses `- role "name" [ref=e5]` lines produced by Playwright's AI ARIA snapshot. */
export function parseOutline(outline: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  for (const line of outline.split("\n")) {
    const m = /^\s*-\s+([a-zA-Z]+)(?:\s+"((?:[^"\\]|\\.)*)")?.*?\[ref=([A-Za-z0-9]+)\]/.exec(line);
    if (m) out.push({ role: m[1]!, name: m[2], ref: m[3]!, line: line.trim() });
  }
  return out;
}

export function controlsOf(outline: string): Control[] {
  return parseOutline(outline)
    .filter((e) => INTERACTIVE.has(e.role))
    .slice(0, MAX_CONTROLS)
    .map((e) => ({ ref: e.ref, role: e.role, ...(e.name !== undefined ? { name: e.name } : {}) }));
}

function renderControls(cs: Control[]): string {
  return cs
    .map((c) => `- ${c.role}${c.name !== undefined ? ` "${c.name}"` : ""} [ref=${c.ref}]`)
    .join("\n");
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.slice(0, maxChars);
  const lastNl = cut.lastIndexOf("\n");
  return { text: (lastNl > 0 ? cut.slice(0, lastNl) : cut) + "\n- … [truncated]", truncated: true };
}

/** Like observe(), but also returns the full (non-delta) observation to use as the next delta basis. */
export async function observeWithBasis(
  adapter: BrowserAdapter,
  opts: { level?: ObservationLevel; ref?: string; maxChars?: number; previous?: Observation },
): Promise<{ observation: Observation; full: Observation }> {
  const level = opts.level ?? "outline";
  const maxChars = opts.maxChars ?? DEFAULT_MAX_OBSERVATION_CHARS;
  const raw = await adapter.observe({
    level: level === "controls" ? "outline" : level,
    ref: opts.ref,
    maxChars,
  });
  const controls = controlsOf(raw.outline);
  const outlineT = truncate(raw.outline, maxChars);
  const view = level === "controls" ? truncate(renderControls(controls), maxChars) : outlineT;
  const obs: Observation = {
    schema: SCHEMAS.observation,
    url: raw.url,
    title: raw.title,
    level,
    outline: outlineT.text,
    controls,
    text: view.text,
    truncated: view.truncated,
    untrusted: true,
    chars: view.text.length,
  };
  const full: Observation = { ...obs };
  if (opts.previous && opts.previous.url === raw.url && opts.previous.level === level) {
    const prev = new Set(opts.previous.text.split("\n"));
    const cur = view.text.split("\n");
    const curSet = new Set(cur);
    const added = cur.filter((l) => !prev.has(l));
    const removed = [...prev].filter((l) => !curSet.has(l));
    obs.delta = { added, removed, unchanged: cur.length - added.length };
    // The delta replaces the view only when it is actually smaller.
    const deltaText = [...added.map((l) => `+ ${l}`), ...removed.map((l) => `- ${l}`)].join("\n");
    if (deltaText.length < view.text.length) {
      obs.text = added.length || removed.length ? deltaText : "(unchanged)";
      obs.chars = obs.text.length;
    }
  }
  return { observation: obs, full };
}

/** Observation of the page, bounded by `maxChars`, optionally as a delta against `previous`. */
export async function observe(
  adapter: BrowserAdapter,
  opts: { level?: ObservationLevel; ref?: string; maxChars?: number; previous?: Observation },
): Promise<Observation> {
  return (await observeWithBasis(adapter, opts)).observation;
}
