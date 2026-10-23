import type { BrowserAdapter } from "./adapter.js";
import { controlsOf } from "./observation.js";
import type { ActionSpec, AdapterErrorCode, Control, Target, Verdict } from "./types.js";

/**
 * Roles that clearly cannot take an op. `combobox` is deliberately absent from the fill and select
 * checks: it covers both native <select> and editable <input> fields, which only the browser can tell
 * apart, so those cases are reported after the attempt (see classifyError) with the same advice.
 */
const TEXT_ENTRY = new Set(["textbox", "searchbox", "spinbutton"]);
const TOGGLE = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"]);
const PRESSABLE = new Set(["button", "link", "tab", "menuitem", "option"]);
const NOT_FILLABLE = new Set([...PRESSABLE, ...TOGGLE, "listbox"]);
const NOT_SELECTABLE = new Set([...TEXT_ENTRY, ...PRESSABLE, ...TOGGLE]);
const NOT_CHECKABLE = new Set([...TEXT_ENTRY, ...PRESSABLE, "combobox", "listbox"]);

/** Role named by a target, when the target states one (innermost target of a `within` chain). */
export function roleOf(t: Target | undefined): string | undefined {
  if (!t) return undefined;
  if ("within" in t || "inFrame" in t) return roleOf(t.target);
  return "role" in t ? t.role : undefined;
}

const q = (s: string) => JSON.stringify(s.length > 40 ? s.slice(0, 40) + "…" : s);

/**
 * Cheap pre-flight check using only what the spec itself states. Returns advice when the op cannot
 * work on the stated role, so the mistake is reported before anything is sent to the page.
 */
export function preflightHint(spec: ActionSpec): string | undefined {
  const role = roleOf(spec.target);
  if (!role) return undefined;
  if (spec.op === "fill" && NOT_FILLABLE.has(role)) {
    if (TOGGLE.has(role)) return `a ${role} is not a text field: use op "check"`;
    if (role === "listbox")
      return `a ${role} is not a text field: use op "select" with the option label`;
    return `a ${role} is not a text field: use op "click"`;
  }
  if (spec.op === "select" && NOT_SELECTABLE.has(role))
    return `a ${role} has no options to select: use "fill" for text fields or "click" for buttons`;
  if (spec.op === "check" && NOT_CHECKABLE.has(role))
    return `a ${role} cannot be checked: use "click" for buttons and links`;
  return undefined;
}

function nameOf(t: Target | undefined): string | undefined {
  if (!t) return undefined;
  if ("within" in t || "inFrame" in t) return nameOf(t.target);
  if ("role" in t) return t.name;
  if ("label" in t) return t.label;
  if ("text" in t) return t.text;
  return undefined;
}

function similar(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tb = b.toLowerCase().split(/\W+/).filter(Boolean);
  if (!ta.size || !tb.length) return 0;
  return tb.filter((w) => ta.has(w)).length / Math.max(ta.size, tb.length);
}

/** Up to five controls whose names look like the wanted one (or the first few if none do). */
export function closestControls(wanted: string | undefined, controls: Control[]): Control[] {
  const named = controls.filter((c) => c.name);
  if (!wanted) return named.slice(0, 5);
  const scored = named
    .map((c) => ({ c, s: similar(wanted, c.name!) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);
  return (scored.length ? scored.map((x) => x.c) : named).slice(0, 5);
}

const NEEDS_CANDIDATES: AdapterErrorCode[] = ["not_found", "strict_violation"];

/**
 * Advice after a failed perform. Uses the error class, and for locator problems one bounded read
 * of the current controls. Names come from the page and are quoted data, not instructions.
 */
export async function hintForFailure(
  spec: ActionSpec,
  code: AdapterErrorCode,
  adapter: BrowserAdapter,
): Promise<string | undefined> {
  if (code === "invalid_action")
    return (
      preflightHint(spec) ??
      `the target does not accept "${spec.op}": for dropdowns use "select", for buttons and links use "click", for checkboxes use "check"`
    );
  if (code === "blocked_by_overlay")
    return "another element covers the target; dismiss the overlay (close/accept button) first";
  if (!NEEDS_CANDIDATES.includes(code)) return undefined;
  try {
    const raw = await adapter.observe({ level: "outline", maxChars: 6000 });
    const near = closestControls(nameOf(spec.target), controlsOf(raw.outline));
    if (!near.length) return undefined;
    const list = near.map((c) => `${c.role} ${q(c.name!)}`).join(", ");
    return code === "strict_violation"
      ? `the target matched several elements; make it more specific. Nearby controls: ${list}`
      : `no matching element. Controls on the page now: ${list}`;
  } catch {
    return undefined;
  }
}

/**
 * Advice for a failed declared check. The common agent mistake is checking an input's value with a
 * text check: page text does not include what was typed into a field.
 */
export function postconditionHint(spec: ActionSpec, v: Verdict): string | undefined {
  const t = v.verifier;
  if (t.type === "text" && spec.value && (t.contains === spec.value || t.equals === spec.value))
    return "text checks read the visible page text, not what was typed into a field. A fill is already verified by an automatic read-back, so leave this check out";
  if (t.type === "text" && !v.definitive)
    return "the text did not appear in time or is worded differently; compare with the page below before repeating anything";
  return undefined;
}
