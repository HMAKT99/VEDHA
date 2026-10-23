import type { ActionSpec, Target } from "@vedha/core";
import type { Mutant } from "../fixtures/todomvc.js";
import type { Scenario } from "./index.js";

/**
 * Independent-application track: TodoMVC (third-party, MIT) with harness-applied mutants (seeded
 * defects in its logic). Markup has no test ids and few labels, so targets are CSS selectors and
 * link names. Declared checks are identical for every driver. Oracle = the list the app reported
 * persisting (instrumented), compared with what the task should have produced.
 */
const NEW: Target = { css: ".new-todo" };
const LIST: Target = { css: ".todo-list" };
const COUNT: Target = { css: ".todo-count" };
const li = (n: number): Target => ({ css: `.todo-list li:nth-child(${n})` });
const inLi = (n: number, css: string): Target => ({ within: li(n), target: { css } });
const link = (name: string): Target => ({ role: "link", name });

const open: ActionSpec = {
  id: "open",
  intent: "open the app",
  op: "goto",
  value: "/",
  postconditions: [{ type: "state", target: NEW, state: "visible" }],
};

const add = (
  id: string,
  title: string,
  extraPost: ActionSpec["postconditions"] = [],
): ActionSpec[] => [
  { id: `${id}-type`, intent: `type "${title}"`, op: "fill", target: NEW, value: title },
  {
    id: `${id}-enter`,
    intent: `add "${title}"`,
    op: "press",
    target: NEW,
    value: "Enter",
    mutating: true,
    postconditions: [{ type: "text", target: LIST, contains: title }, ...extraPost],
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
  mutant?: Mutant;
}

const titles = (t: Array<{ title: string }>) => t.map((x) => x.title);

const DEFS: Def[] = [
  {
    id: "T01-add-two",
    title: "Add two todos",
    steps: [open, ...both()],
    done: (t) => JSON.stringify(titles(t)) === JSON.stringify(["Buy milk", "Walk dog"]),
  },
  {
    id: "T02-complete-one",
    title: "Complete one todo and filter",
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
        target: link("Completed"),
        postconditions: [{ type: "text", target: LIST, equals: "Buy milk" }],
      },
    ],
    done: (t) => t.length === 2 && t[0]!.completed && !t[1]!.completed,
  },
  {
    id: "T03-delete",
    title: "Delete a todo",
    steps: [
      open,
      ...both(),
      { id: "hover", intent: "reveal the delete button", op: "hover", target: li(1) },
      {
        id: "destroy",
        intent: "delete the first todo",
        op: "click",
        target: inLi(1, ".destroy"),
        mutating: true,
        // The counter is recomputed from the model, so a delete that only changed the page cannot satisfy it.
        postconditions: [
          { type: "text", target: LIST, equals: "Walk dog" },
          { type: "text", target: COUNT, contains: "1 item left" },
        ],
      },
    ],
    done: (t) => JSON.stringify(titles(t)) === JSON.stringify(["Walk dog"]),
    mutant: "remove-noop",
  },
  {
    id: "T04-edit",
    title: "Edit a todo and re-check the list",
    steps: [
      open,
      ...add("a", "Buy milk"),
      {
        id: "dbl",
        intent: "start editing",
        op: "dblclick",
        target: { css: ".todo-list li label" },
        enabling: true,
      },
      {
        id: "edit",
        intent: "type the new title",
        op: "fill",
        target: { css: ".todo-list li .edit" },
        value: "Buy oat milk",
      },
      {
        id: "save",
        intent: "save the edit",
        op: "press",
        target: { css: ".todo-list li .edit" },
        value: "Enter",
        mutating: true,
        postconditions: [{ type: "text", target: LIST, contains: "Buy oat milk" }],
      },
      {
        id: "completed",
        intent: "show completed (the list becomes empty)",
        op: "click",
        target: link("Completed"),
        postconditions: [{ type: "text", target: LIST, equals: "" }],
      },
      {
        id: "active",
        intent: "re-render from the model through the Active filter",
        op: "click",
        target: link("Active"),
        postconditions: [{ type: "text", target: LIST, equals: "Buy oat milk" }],
      },
    ],
    done: (t) => JSON.stringify(titles(t)) === JSON.stringify(["Buy oat milk"]),
    mutant: "edit-saves-uppercase",
  },
  {
    id: "T05-toggle-all",
    title: "Mark all todos complete",
    steps: [
      open,
      ...both(),
      {
        id: "all",
        intent: "mark all as complete",
        op: "click",
        target: { css: ".toggle-all-label" },
        mutating: true,
        postconditions: [{ type: "text", target: COUNT, contains: "0 items left" }],
      },
    ],
    done: (t) => t.length === 2 && t.every((x) => x.completed),
    mutant: "toggle-all-first-only",
  },
  {
    id: "T06-clear-completed",
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
        target: { css: ".clear-completed" },
        mutating: true,
        postconditions: [{ type: "text", target: LIST, equals: "Walk dog" }],
      },
    ],
    done: (t) => JSON.stringify(titles(t)) === JSON.stringify(["Walk dog"]),
    mutant: "clear-removes-all",
  },
];

const base = (d: Def) => ({
  variant: {},
  app: "todomvc" as const,
  startPath: "/",
  steps: d.steps,
  duplicates: () => 0,
  title: d.title,
});

const healthy: Scenario[] = DEFS.map((d) => ({
  ...base(d),
  id: d.id,
  category: "baseline" as const,
  kind: "effect" as const,
  todomvc: { mutant: "none" as Mutant },
  effectAchieved: (s) => d.done(s.todos ?? []),
}));

const defects: Scenario[] = DEFS.filter((d) => d.mutant).map((d) => ({
  ...base(d),
  id: `${d.id}-DEFECT`,
  title: `DEFECT (${d.mutant}): ${d.title}`,
  category: "seeded-defect" as const,
  kind: "defect" as const,
  todomvc: { mutant: d.mutant! },
  effectAchieved: () => false,
}));

export const INDEPENDENT_SCENARIOS: Scenario[] = [...healthy, ...defects];
