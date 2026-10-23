import { ShopServer } from "../fixtures/shop.js";
import type { OracleState } from "../fixtures/shop.js";
import { TodoMvcServer } from "../fixtures/todomvc.js";
import { TodoMvcExampleServer } from "../fixtures/todomvc-multi.js";
import { WidgetsServer } from "../fixtures/widgets.js";
import type { Scenario } from "../scenarios/index.js";

export interface FixtureServer {
  start(): Promise<string>;
  oracle(): Promise<OracleState>;
  stop(): Promise<void>;
}

/** The fixture app a scenario runs against (fresh per trial). */
export function makeServer(sc: Scenario, seed: number): FixtureServer {
  if (sc.app === "widgets") return new WidgetsServer(sc.widgets);
  if (sc.app === "todomvc") return new TodoMvcServer(sc.todomvc);
  if (sc.app === "todomvc-multi") return new TodoMvcExampleServer(sc.example!);
  return new ShopServer({ ...sc.variant, seed });
}
