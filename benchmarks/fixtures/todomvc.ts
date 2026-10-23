import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { OracleState } from "./shop.js";

/**
 * Serves the vanilla ES5 TodoMVC example from a local clone of https://github.com/tastejs/todomvc
 * (MIT; third-party code, not written by this project). The clone is NOT vendored: set
 * VEDHA_TODOMVC_DIR to its root (`git clone --depth 1 https://github.com/tastejs/todomvc`). Nothing
 * is installed or executed from it; the files are read and served as static assets.
 *
 * Two harness-side patches are applied to the served JavaScript, never to the clone on disk:
 *  1. Instrumentation: after every write to the app's in-memory store the full list is POSTed to
 *     /__state, which is the oracle (drivers never read it).
 *  2. Mutants (seeded defects): small logic changes that leave the UI looking plausible.
 */
export type Mutant =
  | "none"
  | "remove-noop"
  | "toggle-all-first-only"
  | "edit-saves-uppercase"
  | "clear-removes-all";

const ES5 = "examples/javascript-es5";
const ES6_DIST = "examples/javascript-es6/dist";

export function todomvcDir(): string {
  const dir = process.env.VEDHA_TODOMVC_DIR;
  if (!dir || !fs.existsSync(path.join(dir, ES5, "index.html")))
    throw new Error(
      "the independent-app track needs a local TodoMVC clone: `git clone --depth 1 https://github.com/tastejs/todomvc` and set VEDHA_TODOMVC_DIR to it",
    );
  return path.resolve(dir);
}

const INSTRUMENT = /(MemoryStorage\[this\._dbName\] = JSON\.stringify\(data\);)/g;

function patch(file: string, src: string, mutant: Mutant): string {
  let out = src;
  if (file === "src/store.js") {
    out = out.replace(
      INSTRUMENT,
      `$1 try { fetch("/__state", { method: "POST", keepalive: true, body: MemoryStorage[this._dbName] }); } catch (e) {}`,
    );
    if (mutant === "remove-noop")
      out = out.replace("todos.splice(i, 1);", "/* mutant: not removed */");
  }
  if (file === "src/controller.js") {
    if (mutant === "toggle-all-first-only")
      out = out.replace(
        "self.toggleComplete(item.id, completed, true);",
        "if (item.id === data[0].id) self.toggleComplete(item.id, completed, true);",
      );
    if (mutant === "edit-saves-uppercase")
      out = out.replace(
        "self.model.update(id, { title: title }",
        "self.model.update(id, { title: title.toUpperCase() }",
      );
    if (mutant === "clear-removes-all")
      out = out.replace(
        "self.model.read({ completed: true }, function (data) {\n            data.forEach(function (item) {\n                self.removeItem",
        "self.model.read({}, function (data) {\n            data.forEach(function (item) {\n                self.removeItem",
      );
  }
  return out;
}

export class TodoMvcServer {
  private server?: http.Server;
  private state = "";
  constructor(private readonly opts: { mutant?: Mutant } = {}) {}

  async start(): Promise<string> {
    const root = todomvcDir();
    const mutant = this.opts.mutant ?? "none";
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      const p = url.pathname;
      if (p === "/__state" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          this.state = body;
          res.writeHead(204).end();
        });
        return;
      }
      const send = (file: string, type: string, transform?: (s: string) => string) => {
        try {
          const raw = fs.readFileSync(file, "utf8");
          res.writeHead(200, { "content-type": type }).end(transform ? transform(raw) : raw);
        } catch {
          res.writeHead(404).end("not found");
        }
      };
      if (p === "/" || p === "/index.html")
        return send(path.join(root, ES5, "index.html"), "text/html");
      if (p === "/node_modules/todomvc-common/base.js")
        return send(path.join(root, ES6_DIST, "base.js"), "text/javascript");
      if (p === "/node_modules/todomvc-app-css/index.css")
        return send(path.join(root, ES6_DIST, "app.css"), "text/css");
      if (p === "/node_modules/todomvc-common/base.css") return send("/dev/null", "text/css");
      const m = /^\/src\/([a-z]+\.js)$/.exec(p);
      if (m) {
        const file = `src/${m[1]}`;
        return send(path.join(root, ES5, file), "text/javascript", (s) => patch(file, s, mutant));
      }
      res.writeHead(404).end("not found");
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async oracle(): Promise<OracleState> {
    let todos: Array<{ title: string; completed: boolean }> = [];
    try {
      todos = (JSON.parse(this.state) as { todos: typeof todos }).todos.map((t) => ({
        title: t.title,
        completed: !!t.completed,
      }));
    } catch {
      /* nothing persisted yet */
    }
    return {
      orders: [],
      viewed: [],
      postCount: 0,
      rows: [],
      deletedRows: [],
      leaks: 0,
      upgrades: 0,
      todos,
    };
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections?.();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
