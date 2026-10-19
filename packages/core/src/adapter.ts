import type {
  ActionOp,
  AdapterErrorCode,
  NetworkEntry,
  ObservationLevel,
  Policy,
  Target,
} from "./types.js";

/** Error thrown by adapters; `code` drives recovery decisions. */
export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    /** True when the input event may already have been delivered before the failure. */
    public readonly dispatched = false,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export interface RawObservation {
  url: string;
  title: string;
  outline: string;
}

export type ElementStateName = "visible" | "hidden" | "enabled" | "disabled" | "checked";

/**
 * The only surface the framework needs from a browser. Playwright is the shipped implementation;
 * all methods must honour `timeoutMs` and reject with AdapterError.
 */
export interface BrowserAdapter {
  readonly name: string;
  readonly version?: string;
  applyPolicy(policy: Policy): Promise<void>;
  goto(url: string, timeoutMs: number): Promise<void>;
  currentUrl(): Promise<string>;
  observe(opts: {
    level: ObservationLevel;
    ref?: string;
    maxChars: number;
  }): Promise<RawObservation>;
  perform(
    op: ActionOp,
    target: Target | undefined,
    value: string | undefined,
    timeoutMs: number,
  ): Promise<void>;
  /** Poll until the element reaches the state or timeout; resolves false on timeout. */
  elementState(target: Target, state: ElementStateName, timeoutMs: number): Promise<boolean>;
  /** Text content of the target (or document body when omitted); null when not found. */
  text(target: Target | undefined, timeoutMs: number): Promise<string | null>;
  /** Current value of an input-like target; null when not found. */
  value(target: Target, timeoutMs: number): Promise<string | null>;
  /** Responses seen since the adapter was created, newest last. */
  networkLog(): NetworkEntry[];
  /** Read-only GET relative to the page origin, sharing the browser session. */
  fetchJson(path: string): Promise<{ status: number; body: unknown }>;
  screenshot(): Promise<Uint8Array | undefined>;
  close(): Promise<void>;
}
