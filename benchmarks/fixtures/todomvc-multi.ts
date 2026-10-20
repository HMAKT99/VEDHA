import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { OracleState } from "./shop.js";
import { todomvcDir } from "./todomvc.js";

/**
 * Serves any static TodoMVC implementation from a local clone of tastejs/todomvc (MIT, third-party).
 * `node_modules/todomvc-common` and `todomvc-app-css` are mapped to the ES6 example's prebuilt assets.
 * The oracle is DOM-derived: a small script injected into the served index.html reports the visible
 * todo list (titles and completed state) to /__state, so no implementation is modified.
 */
const OBSERVER = `<script>(function(){
  function snap(){
    // Visible items only: some implementations hide filtered items with CSS instead of removing them.
    var items = Array.prototype.slice.call(document.querySelectorAll(".todo-list li")).filter(function(li){
      var st = getComputedStyle(li); return st.display !== "none" && st.visibility !== "hidden" && li.offsetParent !== null;
    }).map(function(li){
      var lab = li.querySelector("label"); var chk = li.querySelector(".toggle");
      return { title: (lab ? lab.textContent : li.textContent).trim(), completed: !!(chk ? chk.checked : li.classList.contains("completed")) };
    });
    try { fetch("/__state", { method: "POST", keepalive: true, body: JSON.stringify({ todos: items }) }); } catch (e) {}
  }
  // Report immediately (MutationObserver already batches per task): a driver may close the page right after its last action.
  function later(){ snap(); }
  window.addEventListener("load", function(){
    new MutationObserver(later).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener("change", later, true); document.addEventListener("click", later, true);
    later();
  });
})();</script>`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

export class TodoMvcExampleServer {
  private server?: http.Server;
  private state = "";
  constructor(private readonly example: string) {}

  async start(): Promise<string> {
    const root = todomvcDir();
    const dir = path.join(root, "examples", this.example);
    const dist = path.join(root, "examples/javascript-es6/dist");
    this.server = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      if (p === "/__state" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          this.state = body;
          res.writeHead(204).end();
        });
        return;
      }
      let file: string | undefined;
      if (/\/todomvc-common\/base\.js$/.test(p)) file = path.join(dist, "base.js");
      else if (/\/todomvc-common\/base\.css$/.test(p)) file = undefined;
      else if (/\/todomvc-app-css\/index\.css$/.test(p)) file = path.join(dist, "app.css");
      else {
        const rel = p === "/" ? "index.html" : p.replace(/^\//, "");
        const abs = path.resolve(dir, rel);
        if (abs.startsWith(dir + path.sep) || abs === dir) file = abs;
      }
      if (/todomvc-common\/base\.css$/.test(p)) {
        res.writeHead(200, { "content-type": "text/css" }).end("");
        return;
      }
      try {
        if (!file || !fs.statSync(file).isFile()) throw new Error("missing");
        let body: Buffer | string = fs.readFileSync(file);
        const type = MIME[path.extname(file)] ?? "application/octet-stream";
        if (path.basename(file) === "index.html")
          body = body.toString("utf8").replace("</body>", `${OBSERVER}</body>`);
        res.writeHead(200, { "content-type": type }).end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async oracle(): Promise<OracleState> {
    let todos: Array<{ title: string; completed: boolean }> = [];
    try {
      todos = (JSON.parse(this.state) as { todos: typeof todos }).todos;
    } catch {
      /* nothing reported yet */
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

/** Implementations to try, all served from static files in the clone. */
export const CANDIDATES = [
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
  "lavaca_require",
  "riotjs",
  "angularjs_require",
  "backbone_require",
  "knockoutjs_require",
  "canjs_require",
];
