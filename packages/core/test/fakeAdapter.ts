import { AdapterError } from "../src/adapter.js";
import type { BrowserAdapter, ElementStateName, RawObservation } from "../src/adapter.js";
import type {
  ActionOp,
  NetworkEntry,
  ObservationLevel,
  PageEvent,
  Policy,
  Target,
} from "../src/types.js";

export const key = (t: Target | undefined): string => JSON.stringify(t ?? null);

/** Scriptable in-memory adapter for deterministic runner tests (no browser). */
export class FakeAdapter implements BrowserAdapter {
  readonly name = "fake";
  url = "http://app.test/";
  net: NetworkEntry[] = [];
  events: PageEvent[] = [];
  performed: Array<{ op: ActionOp; target?: Target; value?: string }> = [];
  /** target key -> queue of outcomes (Error to throw, undefined to succeed, function to run a side effect). */
  script = new Map<string, Array<AdapterError | undefined | (() => void)>>();
  texts = new Map<string, string>();
  values = new Map<string, string>();
  states = new Map<string, boolean>();
  api = new Map<string, unknown>();
  outline = '- heading "Hello" [ref=e1]';

  queue(t: Target | undefined, ...outcomes: Array<AdapterError | undefined | (() => void)>) {
    this.script.set(key(t), outcomes);
  }

  async applyPolicy(_p: Policy) {}
  async goto(url: string) {
    this.url = url;
  }
  async currentUrl() {
    return this.url;
  }
  async observe(_o: {
    level: ObservationLevel;
    ref?: string;
    maxChars: number;
  }): Promise<RawObservation> {
    return { url: this.url, title: "t", outline: this.outline };
  }
  async perform(op: ActionOp, target: Target | undefined, value: string | undefined) {
    this.performed.push({ op, target, value });
    const q = this.script.get(key(target));
    if (q && q.length) {
      const o = q.length > 1 ? q.shift() : q[0];
      if (typeof o === "function") o();
      else if (o) throw o;
    }
    if (op === "goto" && value) this.url = value;
  }
  async elementState(t: Target, s: ElementStateName) {
    return this.states.get(key(t) + s) ?? false;
  }
  async text(t: Target | undefined) {
    return this.texts.get(key(t)) ?? null;
  }
  async value(t: Target) {
    return this.values.get(key(t)) ?? null;
  }
  networkLog() {
    return this.net;
  }
  pageEvents() {
    return this.events;
  }
  /** Set to a number to make the fake report in-flight requests; undefined = capability absent. */
  pending: number | undefined = undefined;
  pendingRequests() {
    return this.pending as number;
  }
  /** path -> status for fetchJson (default 200). */
  apiStatus = new Map<string, number>();
  async fetchJson(p: string) {
    return { status: this.apiStatus.get(p) ?? 200, body: this.api.get(p) ?? [] };
  }
  async screenshot() {
    return undefined;
  }
  async close() {}
}
