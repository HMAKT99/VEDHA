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

/**
 * Third held-out family (W17-W22), written before the round-4 product changes beyond the write-settle fix and
 * never run by any arm before the pilot-7 run.
 */
const DEFS_V3: Def[] = [
  {
    id: "W17-date-picker",
    goal: `Set the start date to 2026-03-15.`,
    title: "Set a date input",
    startPath: "/date",
    type: "start:2026-03-15",
    steps: [
      open("open", "/date", "Trip dates"),
      {
        id: "date",
        intent: "set the start date",
        op: "fill",
        target: { label: "Start date", exact: true },
        value: "2026-03-15",
        mutating: true,
        postconditions: post("Start date 2026-03-15", "start:2026-03-15"),
      },
    ],
  },
  {
    id: "W18-modal-confirm",
    goal: `Archive the project and confirm in the dialog.`,
    title: "Confirm in a custom modal",
    startPath: "/archive",
    type: "archived",
    steps: [
      open("open", "/archive", "Projects"),
      {
        id: "arch",
        intent: "start archiving",
        op: "click",
        target: { role: "button", name: "Archive project" },
        enabling: true,
      },
      {
        id: "yes",
        intent: "confirm",
        op: "click",
        target: { role: "button", name: "Yes, archive" },
        mutating: true,
        postconditions: post("Project archived", "archived"),
      },
    ],
  },
  {
    id: "W19-two-step-form",
    goal: `Sign up as Ada with the email ada@example.com using the two-step form.`,
    title: "Two-step sign-up form",
    startPath: "/signup",
    type: "signup:Ada/ada@example.com",
    steps: [
      open("open", "/signup", "Sign up"),
      {
        id: "name",
        intent: "enter the name",
        op: "fill",
        target: { label: "Name", exact: true },
        value: "Ada",
      },
      {
        id: "next",
        intent: "next step",
        op: "click",
        target: { role: "button", name: "Next" },
        enabling: true,
      },
      {
        id: "email",
        intent: "enter the email",
        op: "fill",
        target: { label: "Email", exact: true },
        value: "ada@example.com",
      },
      {
        id: "go",
        intent: "create the account",
        op: "click",
        target: { role: "button", name: "Create account" },
        mutating: true,
        postconditions: post(
          "Account created for Ada/ada@example.com",
          "signup:Ada/ada@example.com",
        ),
      },
    ],
  },
  {
    id: "W20-search-filter",
    goal: `Search the catalog for "pen" and apply it with Enter.`,
    title: "Filter a list with Enter",
    startPath: "/search",
    type: "search:pen",
    steps: [
      open("open", "/search", "Catalog"),
      {
        id: "q",
        intent: "type the query",
        op: "fill",
        target: { label: "Search", exact: true },
        value: "pen",
      },
      {
        id: "enter",
        intent: "apply the filter",
        op: "press",
        target: { label: "Search", exact: true },
        value: "Enter",
        mutating: true,
        postconditions: post("Filtered by pen", "search:pen"),
      },
    ],
  },
  {
    id: "W21-inline-edit",
    goal: `Rename the project to Apollo.`,
    title: "Inline rename",
    startPath: "/rename",
    type: "rename:Apollo",
    steps: [
      open("open", "/rename", "Project name"),
      {
        id: "edit",
        intent: "start editing",
        op: "click",
        target: { role: "button", name: "Edit name" },
        enabling: true,
      },
      {
        id: "new",
        intent: "enter the new name",
        op: "fill",
        target: { label: "New name", exact: true },
        value: "Apollo",
      },
      {
        id: "sv",
        intent: "save the name",
        op: "click",
        target: { role: "button", name: "Save name" },
        mutating: true,
        postconditions: post("Renamed to Apollo", "rename:Apollo"),
      },
    ],
  },
  {
    id: "W22-bulk-select",
    goal: `Select the Invoice and Receipt messages and delete the selected ones.`,
    title: "Bulk select and delete",
    startPath: "/bulk",
    type: "bulk-delete:2",
    steps: [
      open("open", "/bulk", "Messages"),
      {
        id: "c1",
        intent: "select Invoice",
        op: "check",
        target: { label: "Invoice", exact: true },
      },
      {
        id: "c2",
        intent: "select Receipt",
        op: "check",
        target: { label: "Receipt", exact: true },
      },
      {
        id: "del",
        intent: "delete selected",
        op: "click",
        target: { role: "button", name: "Delete selected" },
        mutating: true,
        postconditions: post("2 deleted", "bulk-delete:2"),
      },
    ],
  },
];

/** Fourth held-out family (W23-W28), written after the round-4 tool-layer changes and before any run on it. */
const DEFS_V4: Def[] = [
  {
    id: "W23-star-rating",
    goal: `Rate the product 4 stars.`,
    title: "Click a rating",
    startPath: "/rating",
    type: "rate:4",
    steps: [
      open("open", "/rating", "Rate us"),
      {
        id: "rate",
        intent: "rate 4 stars",
        op: "click",
        target: { role: "radio", name: "4 stars" },
        mutating: true,
        postconditions: post("Rated 4 stars", "rate:4"),
      },
    ],
  },
  {
    id: "W24-tag-input",
    goal: `Add the tag "urgent" using the new tag field and the Enter key.`,
    title: "Add a tag with Enter",
    startPath: "/tags",
    type: "tag:urgent",
    steps: [
      open("open", "/tags", "Tags"),
      {
        id: "type",
        intent: "type the tag",
        op: "fill",
        target: { label: "New tag", exact: true },
        value: "urgent",
      },
      {
        id: "enter",
        intent: "add the tag",
        op: "press",
        target: { label: "New tag", exact: true },
        value: "Enter",
        mutating: true,
        postconditions: post("Tag urgent added", "tag:urgent"),
      },
    ],
  },
  {
    id: "W25-password-form",
    goal: `Change the password to "s3cret-pw" (enter it in both fields) and submit.`,
    title: "Change password form",
    startPath: "/password",
    type: "pw-changed",
    steps: [
      open("open", "/password", "Change password"),
      {
        id: "p1",
        intent: "enter the password",
        op: "fill",
        target: { label: "New password", exact: true },
        value: "s3cret-pw",
      },
      {
        id: "p2",
        intent: "repeat the password",
        op: "fill",
        target: { label: "Repeat password", exact: true },
        value: "s3cret-pw",
      },
      {
        id: "go",
        intent: "submit",
        op: "click",
        target: { role: "button", name: "Change password" },
        mutating: true,
        postconditions: post("Password changed", "pw-changed"),
      },
    ],
  },
  {
    id: "W26-carousel",
    goal: `Show the third slide of the gallery.`,
    title: "Advance a carousel twice",
    startPath: "/carousel",
    type: "slide:3",
    steps: [
      open("open", "/carousel", "Gallery"),
      {
        id: "n1",
        intent: "next slide",
        op: "click",
        target: { role: "button", name: "Next slide" },
        mutating: true,
        postconditions: post("Showing slide 2", "slide:2"),
      },
      {
        id: "n2",
        intent: "next slide again",
        op: "click",
        target: { role: "button", name: "Next slide" },
        mutating: true,
        postconditions: post("Showing slide 3", "slide:3"),
      },
    ],
  },
  {
    id: "W27-volume-slider",
    goal: `Set the volume to 70.`,
    title: "Set a range slider",
    startPath: "/volume",
    type: "volume:70",
    steps: [
      open("open", "/volume", "Sound"),
      {
        id: "vol",
        intent: "set volume",
        op: "fill",
        target: { label: "Volume", exact: true },
        value: "70",
        mutating: true,
        postconditions: post("Volume 70", "volume:70"),
      },
    ],
  },
  {
    id: "W28-mark-read",
    goal: `Mark message 42 as read.`,
    title: "Mark as read with a toast",
    startPath: "/inbox",
    type: "read:42",
    steps: [
      open("open", "/inbox", "Inbox"),
      {
        id: "mr",
        intent: "mark as read",
        op: "click",
        target: { role: "button", name: "Mark as read" },
        mutating: true,
        postconditions: post("Message 42 read", "read:42"),
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

const healthyV3: Scenario[] = DEFS_V3.map((d) => ({
  ...base(d),
  id: d.id,
  title: d.title,
  category: "baseline" as const,
  kind: "effect" as const,
  effectAchieved: (s) => (s.events ?? []).filter((e) => e === d.type).length >= (d.min ?? 1),
}));

const DEFECTS_V3: Array<[string, "silent" | "error"]> = [
  ["W17-date-picker", "silent"],
  ["W18-modal-confirm", "error"],
  ["W19-two-step-form", "silent"],
  ["W20-search-filter", "error"],
  ["W21-inline-edit", "silent"],
  ["W22-bulk-select", "error"],
];

const defectsV3: Scenario[] = DEFECTS_V3.map(([id, bug]) => {
  const d = DEFS_V3.find((x) => x.id === id)!;
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

/** Held-out set 3 (see DEFS_V3). */
export const WIDGET_SCENARIOS_V3: Scenario[] = [...healthyV3, ...defectsV3];

const healthyV4: Scenario[] = DEFS_V4.map((d) => ({
  ...base(d),
  id: d.id,
  title: d.title,
  category: "baseline" as const,
  kind: "effect" as const,
  effectAchieved: (s) => (s.events ?? []).filter((e) => e === d.type).length >= (d.min ?? 1),
}));

const DEFECTS_V4: Array<[string, "silent" | "error"]> = [
  ["W23-star-rating", "silent"],
  ["W24-tag-input", "error"],
  ["W25-password-form", "silent"],
  ["W26-carousel", "error"],
  ["W27-volume-slider", "silent"],
  ["W28-mark-read", "error"],
];

const defectsV4: Scenario[] = DEFECTS_V4.map(([id, bug]) => {
  const d = DEFS_V4.find((x) => x.id === id)!;
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

/** Held-out set 4 (see DEFS_V4). */
export const WIDGET_SCENARIOS_V4: Scenario[] = [...healthyV4, ...defectsV4];
