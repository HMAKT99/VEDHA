import type { ActionSpec, Policy } from "@vedha/core";
import type { OracleState, Variant } from "../fixtures/shop.js";
import type { Mutant } from "../fixtures/todomvc.js";
import type { WidgetsVariant } from "../fixtures/widgets.js";

/**
 * Neutral task definition shared by every driver. Each driver may use only the parts its own
 * semantics support (see methodology.md "Driver capability matrix"). The oracle functions run in
 * the harness on server-side state and are never visible to drivers.
 */
export interface Scenario {
  id: string;
  title: string;
  /** Grouping used for reporting; categories are never merged into one score. */
  category:
    | "baseline"
    | "dynamic"
    | "interstitial"
    | "ui-change"
    | "seeded-defect"
    | "transient"
    | "navigation"
    | "auth"
    | "hazard";
  /**
   * "effect": the product is correct, the task should succeed.
   * "defect": a seeded product defect exists, the correct outcome is to report failure.
   */
  kind: "effect" | "defect";
  variant: Variant;
  /** Fixture app serving the scenario (default: the shop). */
  app?: "shop" | "widgets" | "todomvc" | "todomvc-multi";
  /** Which TodoMVC implementation (`todomvc-multi` only). */
  example?: string;
  widgets?: WidgetsVariant;
  todomvc?: { mutant: Mutant };
  /** Policy for drivers that have one (dialogs, uploadRoots); baselines honour `dialogs: "accept"`. */
  policy?: Policy;
  startPath: string;
  /** Plain-language task for LLM-driven tracks (the scripted tracks use `steps`). */
  goal?: string;
  steps: ActionSpec[];
  /** True iff the intended real-world effect happened (server-side truth). */
  effectAchieved(s: OracleState): boolean;
  /** Unintended side effects (duplicate orders, or rows deleted other than the intended one) - lower is better. */
  duplicates(s: OracleState): number;
}

const ORDER_OK = (s: OracleState) =>
  s.orders.length === 1 && s.orders[0]!.name === "Ada" && s.orders[0]!.qty === 3;
const ORDER_DUPES = (s: OracleState) => Math.max(0, s.orders.length - 1);

function orderSteps(opts: { timeoutMs?: number; submitName?: string } = {}): ActionSpec[] {
  const t = opts.timeoutMs;
  return [
    {
      id: "open",
      intent: "open the order form",
      op: "goto",
      value: "/",
      postconditions: [{ type: "state", target: { label: "Name", exact: true }, state: "visible" }],
      timeoutMs: t,
    },
    {
      id: "name",
      intent: "enter the customer name",
      op: "fill",
      target: { label: "Name", exact: true },
      value: "Ada",
      postconditions: [{ type: "value", target: { label: "Name", exact: true }, equals: "Ada" }],
      timeoutMs: t,
    },
    {
      id: "qty",
      intent: "enter the quantity",
      op: "fill",
      target: { label: "Quantity", exact: true },
      value: "3",
      postconditions: [{ type: "value", target: { label: "Quantity", exact: true }, equals: "3" }],
      timeoutMs: t,
    },
    {
      id: "submit",
      intent: "place the order",
      op: "click",
      target: { role: "button", name: opts.submitName ?? "Place order" },
      altTargets: [{ testId: "place-order" }],
      dismiss: [{ role: "button", name: "Accept" }],
      mutating: true,
      timeoutMs: t,
      postconditions: [
        { type: "text", target: { role: "status" }, contains: "Order placed" },
        {
          type: "network",
          method: "POST",
          urlPattern: "/api/orders",
          status: "2xx",
          json: { path: "qty", equals: 3 },
        },
      ],
      reconcile: { type: "api", get: "/api/orders", matchesAny: { name: "Ada", qty: 3 } },
    },
  ];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "S01-order-clean",
    title: "Place an order on a healthy app",
    category: "baseline",
    kind: "effect",
    variant: {},
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S02-order-slow-ui",
    title: "Success message appears after a jittered 0.4-1.2 s delay",
    category: "dynamic",
    kind: "effect",
    variant: { uiDelayMs: [400, 1200] },
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S03-order-cookie-banner",
    title: "Full-screen cookie banner appears 300 ms after load",
    category: "interstitial",
    kind: "effect",
    variant: { cookieBanner: true },
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S04-order-renamed-button",
    title: "Submit button renamed to 'Submit order' (test id unchanged)",
    category: "ui-change",
    kind: "effect",
    variant: { renameSubmit: true },
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S05-order-banner-and-rename",
    title: "Banner and renamed button together",
    category: "ui-change",
    kind: "effect",
    variant: { cookieBanner: true, renameSubmit: true },
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S06-defect-silent-500",
    title: "DEFECT: server returns 500, UI still shows 'Order placed'",
    category: "seeded-defect",
    kind: "defect",
    variant: { bug: "silent" },
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S07-defect-wrong-quantity",
    title: "DEFECT: server stores quantity+1, UI shows success",
    category: "seeded-defect",
    kind: "defect",
    variant: { bug: "wrongqty" },
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S08-defect-disabled-submit",
    title: "DEFECT: submit button permanently disabled",
    category: "seeded-defect",
    kind: "defect",
    variant: { disabledSubmit: true },
    startPath: "/",
    steps: orderSteps({ timeoutMs: 3000 }),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S09-transient-503",
    title: "First POST fails with 503 before committing; retry works",
    category: "transient",
    kind: "effect",
    variant: { transient503: true },
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S10-commit-then-late-response",
    title: "Order commits but the response arrives after the step timeout",
    category: "transient",
    kind: "effect",
    variant: { commitDelayMs: 6000 },
    startPath: "/",
    steps: orderSteps({ timeoutMs: 2500 }),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S11-search-paginate-open",
    title: "Search, go to page 2, open 'Item 29'",
    category: "navigation",
    kind: "effect",
    variant: {},
    startPath: "/items",
    steps: [
      {
        id: "open",
        intent: "open the item list",
        op: "goto",
        value: "/items",
        postconditions: [{ type: "text", target: { role: "heading" }, equals: "Items" }],
      },
      {
        id: "q",
        intent: "type the search term",
        op: "fill",
        target: { label: "Search", exact: true },
        value: "Item 2",
        postconditions: [
          { type: "value", target: { label: "Search", exact: true }, equals: "Item 2" },
        ],
      },
      {
        id: "search",
        intent: "run the search",
        op: "click",
        target: { role: "button", name: "Search" },
        postconditions: [{ type: "url", matches: "q=Item" }],
      },
      {
        id: "next",
        intent: "go to the next page",
        op: "click",
        target: { role: "link", name: "Next" },
        postconditions: [{ type: "text", contains: "Page 2 of 2" }],
      },
      {
        id: "open29",
        intent: "open Item 29",
        op: "click",
        target: { role: "link", name: "Item 29" },
        postconditions: [
          { type: "url", matches: "/items/29" },
          { type: "text", target: { role: "heading" }, equals: "Item 29" },
        ],
      },
    ],
    effectAchieved: (s) => s.viewed.includes(29),
    duplicates: () => 0,
  },
];

// ---- Added after the framework was frozen for this run (S12-S15); not used to tune Vedha. ----
const loginSteps = (): ActionSpec[] => [
  {
    id: "login-open",
    intent: "open the sign-in page",
    op: "goto",
    value: "/login",
    postconditions: [{ type: "text", target: { role: "heading" }, equals: "Sign in" }],
  },
  {
    id: "user",
    intent: "enter the username",
    op: "fill",
    target: { label: "Username", exact: true },
    value: "ada",
    postconditions: [{ type: "value", target: { label: "Username", exact: true }, equals: "ada" }],
  },
  {
    id: "pass",
    intent: "enter the password",
    op: "fill",
    target: { label: "Password", exact: true },
    value: "secret",
  },
  {
    id: "signin",
    intent: "sign in",
    op: "click",
    target: { role: "button", name: "Sign in" },
    postconditions: [
      { type: "text", target: { role: "status" }, contains: "Signed in" },
      { type: "network", method: "POST", urlPattern: "/api/login", status: "2xx" },
    ],
  },
  {
    id: "secure",
    intent: "open the order form",
    op: "goto",
    value: "/secure",
    postconditions: [{ type: "state", target: { label: "Name", exact: true }, state: "visible" }],
  },
];

const rowsPage = (): ActionSpec => ({
  id: "rows",
  intent: "open the rows table",
  op: "goto",
  value: "/rows",
  postconditions: [{ type: "text", target: { role: "heading" }, equals: "Rows" }],
});
const deleteBob = (target: ActionSpec["target"]): ActionSpec => ({
  id: "delete",
  intent: "delete Bob's row",
  op: "click",
  target,
  mutating: true,
  destructive: true,
  timeoutMs: 3000,
  postconditions: [
    { type: "text", target: { role: "status" }, contains: "Deleted Bob" },
    { type: "network", method: "DELETE", urlPattern: "/api/rows/2", status: "2xx" },
  ],
});

SCENARIOS.push(
  {
    id: "S12-login-then-order",
    title: "Sign in, then place an order (auth required)",
    category: "auth",
    kind: "effect",
    variant: { requireAuth: true },
    startPath: "/login",
    steps: [...loginSteps(), ...orderSteps().slice(1)],
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S13-defect-session-invalidated",
    title: "DEFECT: session silently invalidated after login; order POST returns 401",
    category: "auth",
    kind: "defect",
    variant: { requireAuth: true, expireSession: true },
    startPath: "/login",
    steps: [...loginSteps(), ...orderSteps().slice(1)],
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
  {
    id: "S14-ambiguous-delete",
    title:
      "HAZARD: three identical 'Delete' buttons, spec names no row; correct report is fail with nothing deleted",
    category: "hazard",
    kind: "defect",
    variant: {},
    startPath: "/rows",
    steps: [rowsPage(), deleteBob({ role: "button", name: "Delete" })],
    effectAchieved: (s) => s.deletedRows.includes(2),
    duplicates: (s) => s.deletedRows.filter((id) => id !== 2).length,
  },
  {
    id: "S15-delete-scoped-row",
    title: "Delete Bob's row using a row-scoped target",
    category: "hazard",
    kind: "effect",
    variant: {},
    startPath: "/rows",
    steps: [
      rowsPage(),
      deleteBob({
        within: { role: "row", name: "Bob" },
        target: { role: "button", name: "Delete" },
      }),
    ],
    effectAchieved: (s) => s.deletedRows.length === 1 && s.deletedRows[0] === 2,
    duplicates: (s) => s.deletedRows.filter((id) => id !== 2).length,
  },
  // ---- Added after read-back inference (P1) was built: a POSITIVE CONTROL, not a held-out result. ----
  {
    id: "S16-defect-dropped-write",
    title:
      "DEFECT (post-hoc control): POST /api/orders answers 201 with the order but never stores it",
    category: "seeded-defect",
    kind: "defect",
    variant: { bug: "dropped" },
    startPath: "/",
    steps: orderSteps(),
    effectAchieved: ORDER_OK,
    duplicates: ORDER_DUPES,
  },
);
