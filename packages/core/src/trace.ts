import { redactDeep } from "./policy.js";
import { SCHEMAS } from "./types.js";
import type { TraceEvent } from "./types.js";

/** In-memory structured trace; every event is redacted before being stored. */
export class Trace {
  readonly events: TraceEvent[] = [];
  private readonly t0 = Date.now();

  constructor(private readonly secrets: string[] = []) {}

  emit(kind: TraceEvent["kind"], data: Record<string, unknown>): void {
    this.events.push({
      schema: SCHEMAS.traceEvent,
      t: Date.now() - this.t0,
      kind,
      data: redactDeep(data, this.secrets),
    });
  }

  toNdjson(): string {
    return this.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }
}
