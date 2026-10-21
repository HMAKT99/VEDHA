import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ActionSpec, Target, Verifier } from "@vedha/core";
import type { Scenario } from "./index.js";

/**
 * Held-out scenario families on the widgets fixture (hover, double click, uncheck, upload, scroll,
 * drag, dialog, popup, iframe, history). Defined after the pre-registration; not used to tune
 * the framework. Every healthy scenario has an effect recorded server-side; defect variants make
 * the server drop ("silent": 200, nothing recorded) or reject ("error": 500) the effect while the
 * page still shows success. Declared checks are identical for every driver; each driver applies
 * the kinds it supports (see methodology "Driver capability matrix").
 */
export const UPLOAD_DIR = path.join(os.tmpdir(), "vedha-bench-files");
export const UPLOAD_FILE = path.join(UPLOAD_DIR, "a.txt");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.writeFileSync(UPLOAD_FILE, "hello");

const status: Target = { role: "status" };
const FRAME = "iframe[title=payment]";

const post = (statusText: string, type: string, statusTarget: Target = status): Verifier[] => [
  { type: "text", target: statusTarget, contains: statusText },
  { type: "network", method: "POST", urlPattern: "/api/event", status: "2xx" },
  { type: "api", get: "/api/events", matchesAny: { type } },
];

const open = (id: string, p: string, heading: string): ActionSpec => ({
  id,
  intent: `open ${p}`,
  op: "goto",
  value: p,
  postconditions: [{ type: "text", target: { role: "heading" }, equals: heading }],
});

interface Def {
  id: string;
  goal: string;
  title: string;
  startPath: string;
  steps: ActionSpec[];
  type: string;
  /** Present for defect variants. */
  bug?: "silent" | "error";
  policy?: Scenario["policy"];
  /** For events that may legitimately be recorded more than once. */
  min?: number;
}

const DEFS: Def[] = [
  {
    id: "W01-hover-menu",
    goal: `Open the Products menu and choose Laptops.`,
    title: "Hover a menu, then pick an item",
    startPath: "/hover",
    type: "laptops",
    steps: [
      open("open", "/hover", "Hover menu"),
      {
        id: "hover",
        intent: "reveal the menu",
        op: "hover",
        target: { text: "Products", exact: true },
      },
      {
        id: "pick",
        intent: "choose Laptops",
        op: "click",
        target: { role: "button", name: "Laptops" },
        mutating: true,
        postconditions: post("Laptops opened", "laptops"),
      },
    ],
  },
  {
    id: "W02-double-click",
    goal: `Double click the \"Edit title\" button.`,
    title: "Double click to edit",
    startPath: "/dblclick",
    type: "title-edited",
    steps: [
      open("open", "/dblclick", "Double click"),
      {
        id: "dbl",
        intent: "double click Edit title",
        op: "dblclick",
        target: { role: "button", name: "Edit title" },
        mutating: true,
        postconditions: post("double clicked", "title-edited"),
      },
    ],
  },
  {
    id: "W03-uncheck",
    goal: `Turn off the \"Subscribe to news\" preference.`,
    title: "Uncheck a preference",
    startPath: "/checks",
    type: "unsubscribed",
    steps: [
      open("open", "/checks", "Preferences"),
      {
        id: "off",
        intent: "uncheck subscribe",
        op: "uncheck",
        target: { label: "Subscribe to news", exact: true },
        mutating: true,
        postconditions: post("Unsubscribed", "unsubscribed"),
      },
    ],
  },
  {
    id: "W04-upload",
    goal: `Attach the file ${UPLOAD_FILE} using the Attachment field.`,
    title: "Attach a file",
    startPath: "/upload",
    type: "upload:a.txt",
    policy: { uploadRoots: [UPLOAD_DIR] },
    steps: [
      open("open", "/upload", "Upload"),
      {
        id: "up",
        intent: "attach a.txt",
        op: "upload",
        target: { label: "Attachment", exact: true },
        value: UPLOAD_FILE,
        mutating: true,
        postconditions: post("Received a.txt (5 bytes)", "upload:a.txt"),
      },
    ],
  },
  {
    id: "W05-scroll-load",
    goal: `Scroll to the end of the page so that more items load.`,
    title: "Scroll to the end to load more",
    startPath: "/scroll",
    type: "more-loaded",
    steps: [
      open("open", "/scroll", "Long page"),
      {
        id: "bottom",
        intent: "scroll to the bottom",
        op: "scroll",
        value: "bottom",
        postconditions: post("More items loaded", "more-loaded"),
      },
    ],
  },
  {
    id: "W06-drag-drop",
    goal: `Drag Card A into the drop zone.`,
    title: "Drag a card into the drop zone",
    startPath: "/drag",
    type: "dropped:A",
    steps: [
      open("open", "/drag", "Drag and drop"),
      {
        id: "drag",
        intent: "drag Card A to the drop zone",
        op: "drag",
        target: { text: "Card A", exact: true },
        to: { text: "Drop zone", exact: true },
        mutating: true,
        postconditions: post("Dropped A", "dropped:A"),
      },
    ],
  },
  {
    id: "W07-confirm-dialog",
    goal: `Delete the item and confirm the dialog.`,
    title: "Delete an item and confirm the dialog",
    startPath: "/dialog",
    type: "deleted",
    policy: { dialogs: "accept" },
    steps: [
      open("open", "/dialog", "Delete item"),
      {
        id: "del",
        intent: "delete the item",
        op: "click",
        target: { role: "button", name: "Delete item" },
        mutating: true,
        postconditions: post("Deleted", "deleted"),
      },
    ],
  },
  {
    id: "W08-popup-tab",
    goal: `Open the receipt in its tab and read its heading.`,
    title: "Open a receipt in a new tab",
    startPath: "/popup",
    type: "receipt-viewed",
    steps: [
      open("open", "/popup", "Orders"),
      {
        id: "link",
        intent: "open the receipt",
        op: "click",
        target: { role: "link", name: "Open receipt" },
        enabling: true,
      },
      {
        id: "tab",
        intent: "switch to the receipt tab",
        op: "switch_tab",
        value: "last",
        postconditions: [
          { type: "text", target: { role: "heading" }, equals: "Receipt 42" },
          { type: "api", get: "/api/events", matchesAny: { type: "receipt-viewed" } },
        ],
      },
    ],
  },
  {
    id: "W09-iframe-form",
    goal: `In the checkout payment form, enter card number 4242 and pay.`,
    title: "Pay inside an iframe",
    startPath: "/frame",
    type: "paid:4242",
    steps: [
      open("open", "/frame", "Checkout"),
      {
        id: "card",
        intent: "enter the card number",
        op: "fill",
        target: { inFrame: FRAME, target: { label: "Card number", exact: true } },
        value: "4242",
      },
      {
        id: "pay",
        intent: "pay",
        op: "click",
        target: { inFrame: FRAME, target: { role: "button", name: "Pay" } },
        mutating: true,
        postconditions: post("Paid with 4242", "paid:4242", { inFrame: FRAME, target: status }),
      },
    ],
  },
  {
    id: "W10-history-back",
    goal: `Go to the next page, then come back to the first page.`,
    title: "Go to the next page and back",
    startPath: "/nav",
    type: "nav2-loaded",
    steps: [
      open("open", "/nav", "Start"),
      {
        id: "next",
        intent: "go to the next page",
        op: "click",
        target: { role: "link", name: "Next page" },
        postconditions: [{ type: "url", matches: "/nav2" }],
      },
      {
        id: "back",
        intent: "go back",
        op: "back",
        postconditions: [{ type: "url", matches: "/nav" }],
      },
    ],
  },
];

/**
 * Second held-out family (W11-W16), written before the changes of improvement round 4 and never viewed or run
 * before them (the freeze commit is recorded in the pilot 6 results README).
 */
const DEFS_V2: Def[] = [
  {
    id: "W11-tabs",
    goal: `Open the Billing tab.`,
    title: "Switch to the Billing tab",
    startPath: "/tabs",
    type: "billing-tab",
    steps: [
      open("open", "/tabs", "Account tabs"),
      {
        id: "tab",
        intent: "open Billing",
        op: "click",
        target: { role: "tab", name: "Billing" },
        mutating: true,
        postconditions: post("Billing shown", "billing-tab"),
      },
    ],
  },
  {
    id: "W12-select-plan",
    goal: `Choose the Pro plan.`,
    title: "Choose a plan from a select",
    startPath: "/plan",
    type: "plan:pro",
    steps: [
      open("open", "/plan", "Choose a plan"),
      {
        id: "pick",
        intent: "choose Pro",
        op: "select",
        target: { label: "Plan", exact: true },
        value: "Pro",
        mutating: true,
        postconditions: post("Plan Pro", "plan:pro"),
      },
    ],
  },
  {
    id: "W13-toggle",
    goal: `Turn Dark mode on.`,
    title: "Turn on a switch",
    startPath: "/toggle",
    type: "dark:on",
    steps: [
      open("open", "/toggle", "Appearance"),
      {
        id: "on",
        intent: "turn dark mode on",
        op: "click",
        target: { role: "switch", name: "Dark mode" },
        mutating: true,
        postconditions: post("Dark mode on", "dark:on"),
      },
    ],
  },
  {
    id: "W14-accordion-form",
    goal: `Open Shipping details, enter the address 12 Main St and save it.`,
    title: "Expand a section, fill and save",
    startPath: "/accordion",
    type: "address:12 Main St",
    steps: [
      open("open", "/accordion", "Checkout details"),
      {
        id: "expand",
        intent: "open Shipping details",
        op: "click",
        target: { role: "button", name: "Shipping details" },
        enabling: true,
      },
      {
        id: "addr",
        intent: "enter the address",
        op: "fill",
        target: { label: "Address", exact: true },
        value: "12 Main St",
      },
      {
        id: "save",
        intent: "save the address",
        op: "click",
        target: { role: "button", name: "Save address" },
        mutating: true,
        postconditions: post("Saved 12 Main St", "address:12 Main St"),
      },
    ],
  },
  {
    id: "W15-reorder",
    goal: `Move Beta above Alpha in the list.`,
    title: "Reorder a list",
    startPath: "/reorder",
    type: "moved:Beta",
    steps: [
      open("open", "/reorder", "Priorities"),
      {
        id: "up",
        intent: "move Beta up",
        op: "click",
        target: { role: "button", name: "Move Beta up" },
        mutating: true,
        postconditions: post("Beta moved up", "moved:Beta"),
      },
    ],
  },
  {
    id: "W16-escape-key",
    goal: `Close the help panel with the keyboard.`,
    title: "Close a panel with Escape",
    startPath: "/keys",
    type: "help-closed",
    steps: [
      open("open", "/keys", "Help"),
      {
        id: "esc",
        intent: "press Escape",
        op: "press",
        value: "Escape",
        mutating: true,
        postconditions: post("Panel closed", "help-closed"),
      },
    ],
  },
];

const base = (d: Def): Omit<Scenario, "id" | "title" | "kind" | "category" | "effectAchieved"> => ({
  variant: {},
  app: "widgets",
  startPath: d.startPath,
  goal: d.goal,
  steps: d.steps,
  policy: d.policy,
  duplicates: () => 0,
});

const healthy: Scenario[] = DEFS.map((d) => ({
  ...base(d),
  id: d.id,
  title: d.title,
  category: "baseline" as const,
  kind: "effect" as const,
  effectAchieved: (s) => (s.events ?? []).filter((e) => e === d.type).length >= (d.min ?? 1),
}));

/** Defect variants: the page claims success while the server drops or rejects the effect. */
const DEFECTS: Array<[string, "silent" | "error"]> = [
  ["W01-hover-menu", "silent"],
  ["W02-double-click", "error"],
  ["W03-uncheck", "silent"],
  ["W04-upload", "error"],
  ["W06-drag-drop", "silent"],
  ["W07-confirm-dialog", "error"],
  ["W09-iframe-form", "silent"],
];

const defects: Scenario[] = DEFECTS.map(([id, bug]) => {
  const d = DEFS.find((x) => x.id === id)!;
  return {
    ...base(d),
    id: `${id}-DEFECT-${bug}`,
    title: `DEFECT (${bug}): ${d.title}`,
    category: "seeded-defect" as const,
    kind: "defect" as const,
    widgets: { bug },
    effectAchieved: () => false,
  };
});

export const WIDGET_SCENARIOS: Scenario[] = [...healthy, ...defects];

const healthyV2: Scenario[] = DEFS_V2.map((d) => ({
  ...base(d),
  id: d.id,
  title: d.title,
  category: "baseline" as const,
  kind: "effect" as const,
  effectAchieved: (s) => (s.events ?? []).filter((e) => e === d.type).length >= (d.min ?? 1),
}));

const DEFECTS_V2: Array<[string, "silent" | "error"]> = [
  ["W11-tabs", "silent"],
  ["W12-select-plan", "error"],
  ["W13-toggle", "silent"],
  ["W15-reorder", "error"],
  ["W16-escape-key", "silent"],
];

const defectsV2: Scenario[] = DEFECTS_V2.map(([id, bug]) => {
  const d = DEFS_V2.find((x) => x.id === id)!;
  return {
    ...base(d),
    id: `${id}-DEFECT-${bug}`,
    title: `DEFECT (${bug}): ${d.title}`,
    category: "seeded-defect" as const,
    kind: "defect" as const,
    widgets: { bug },
    effectAchieved: () => false,
  };
});

/** Held-out set 2 (see DEFS_V2). Kept out of WIDGET_SCENARIOS so earlier tracks keep their membership. */
export const WIDGET_SCENARIOS_V2: Scenario[] = [...healthyV2, ...defectsV2];

/**
 * Same scenarios with only the declarations a typical author or LLM writes: what the page shows
 * (text) and where it ends up (url). No response or state checks. Defects that only a response or
 * state check can reveal are expected to be missed by every driver, except where a driver has its own
 * page-health check (Vedha on rejected writes).
 */
export const WIDGET_SCENARIOS_MINIMAL: Scenario[] = WIDGET_SCENARIOS.map((sc) => ({
  ...sc,
  id: `${sc.id}-min`,
  title: `${sc.title} [minimal declarations]`,
  steps: sc.steps.map((st) => ({
    ...st,
    postconditions: st.postconditions?.filter((v) => v.type === "text" || v.type === "url"),
  })),
}));
