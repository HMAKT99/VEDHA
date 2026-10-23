import type { ActionSpec, Target } from "@vedha/core";
import { CANDIDATES } from "../fixtures/todomvc-multi.js";
import type { Scenario } from "./index.js";

/**
 * Cross-implementation track: the same user-level scenarios on third-party TodoMVC implementations
 * (tastejs/todomvc, MIT). The spec fixes class names but not markup structure or roles, so the new-todo
 * field is found by its accessible name (placeholder) and the filters/buttons by role and name, as a
 * user-level test would. Healthy scenarios only: the question is whether a driver completes the task
 * and reports it correctly on markup it was not written against. Oracle: the DOM-derived todo list.
 */
export const WORKING = [
  "javascript-es5",
  "backbone_marionette",
  "canjs",
  "closure",
  "exoskeleton",
  "jsblocks",
  "knockback",
  "knockoutjs",
  "mithril",
  "polymer",
  "ractive",
  "typescript-backbone",
  "typescript-react",
  "dijon",
  "riotjs",
  "canjs_require",
].filter((x) => CANDIDATES.includes(x));

const NEW: Target = { role: "textbox", name: "What needs to be done?" };
const LIST: Target = { css: ".todo-list" };
const COUNT: Target = { css: ".todo-count" };
const li = (n: number): Target => ({ css: `.todo-list li:nth-child(${n})` });
const inLi = (n: number, css: string): Target => ({ within: li(n), target: { css } });

const open: ActionSpec = {
  id: "open",
  intent: "open the app",
  op: "goto",
  value: "/",
  postconditions: [{ type: "state", target: NEW, state: "visible" }],
};
const add = (id: string, title: string, extra: ActionSpec["postconditions"] = []): ActionSpec[] => [
  { id: `${id}-type`, intent: `type "${title}"`, op: "fill", target: NEW, value: title },
  {
    id: `${id}-enter`,
    intent: `add "${title}"`,
    op: "press",
    target: NEW,
    value: "Enter",
    mutating: true,
    postconditions: [{ type: "text", target: LIST, contains: title }, ...extra],
  },
];
const both = (): ActionSpec[] => [
  ...add("a", "Buy milk"),
  ...add("b", "Walk dog", [{ type: "text", target: COUNT, contains: "2 items left" }]),
];

interface Def {
  id: string;
  title: string;
  steps: ActionSpec[];
  done: (t: Array<{ title: string; completed: boolean }>) => boolean;
}
const names = (t: Array<{ title: string }>) => JSON.stringify(t.map((x) => x.title));

const DEFS: Def[] = [
  {
    id: "M1-add-two",
    title: "Add two todos",
    steps: [open, ...both()],
    done: (t) => names(t) === JSON.stringify(["Buy milk", "Walk dog"]),
  },
  {
    id: "M2-complete-filter",
    title: "Complete one todo and show completed",
    steps: [
      open,
      ...both(),
      {
        id: "toggle",
        intent: "complete the first todo",
        op: "click",
        target: inLi(1, ".toggle"),
        mutating: true,
        postconditions: [{ type: "text", target: COUNT, contains: "1 item left" }],
      },
      {
        id: "completed",
        intent: "show completed",
        op: "click",
        target: { role: "link", name: "Completed" },
        postconditions: [{ type: "text", target: LIST, equals: "Buy milk" }],
      },
    ],
    // The oracle reads the visible list, which after "show completed" is just the completed todo.
    done: (t) => t.length === 1 && t[0]?.title === "Buy milk" && !!t[0]?.completed,
  },
  {
    id: "M3-delete",
    title: "Delete a todo",
    steps: [
      open,
      ...both(),
      { id: "hover", intent: "reveal delete", op: "hover", target: li(1) },
      {
        id: "destroy",
        intent: "delete the first todo",
        op: "click",
        target: inLi(1, ".destroy"),
        mutating: true,
        postconditions: [
          { type: "text", target: LIST, equals: "Walk dog" },
          { type: "text", target: COUNT, contains: "1 item left" },
        ],
      },
    ],
    done: (t) => names(t) === JSON.stringify(["Walk dog"]),
  },
  {
    id: "M4-clear-completed",
    title: "Clear completed todos",
    steps: [
      open,
      ...both(),
      {
        id: "toggle",
        intent: "complete the first todo",
        op: "click",
        target: inLi(1, ".toggle"),
        enabling: true,
      },
      {
        id: "clear",
        intent: "clear completed",
        op: "click",
        target: { role: "button", name: "Clear completed" },
        mutating: true,
        postconditions: [{ type: "text", target: LIST, equals: "Walk dog" }],
      },
    ],
    done: (t) => names(t) === JSON.stringify(["Walk dog"]),
  },
];

export const MULTI_SCENARIOS: Scenario[] = WORKING.flatMap((example) =>
  DEFS.map((d) => ({
    id: `${d.id}@${example}`,
    title: `${d.title} [${example}]`,
    category: "baseline" as const,
    kind: "effect" as const,
    variant: {},
    app: "todomvc-multi" as const,
    example,
    startPath: "/",
    steps: d.steps,
    duplicates: () => 0,
    effectAchieved: (s: { todos?: Array<{ title: string; completed: boolean }> }) =>
      d.done(s.todos ?? []),
  })),
);
