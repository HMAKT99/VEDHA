import http from "node:http";
import type { AddressInfo } from "node:net";
import type { OracleState } from "./shop.js";

/**
 * Small pages that each need one interaction beyond click/fill: hover menu, double click, uncheck,
 * file upload, scroll-triggered loading, drag and drop, JavaScript dialogs, popups, iframes and
 * history navigation. Every page reports its result in a `role=status` element.
 */
const page = (title: string, body: string, script = ""): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;margin:24px}.drop{border:2px dashed #888;padding:24px;margin-top:12px}
.item{display:inline-block;padding:8px;background:#def;cursor:grab}</style></head><body>
<h1>${title}</h1>${body}<p role="status" id="status"></p><script>
const say = (t) => { document.getElementById("status").textContent = t; };
const report = async (type) => {
  try { await fetch("/api/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type }) }); } catch (e) {}
};${script}</script></body></html>`;

const PAGES: Record<string, string> = {
  "/hover": page(
    "Hover menu",
    `<div id="products" tabindex="0">Products</div>
     <ul id="sub" hidden><li><button id="laptops">Laptops</button></li></ul>`,
    `const sub = document.getElementById("sub");
     document.getElementById("products").addEventListener("mouseenter", () => { sub.hidden = false; });
     document.getElementById("laptops").addEventListener("click", async () => { await report("laptops"); say("Laptops opened"); });`,
  ),
  "/dblclick": page(
    "Double click",
    `<button id="b">Edit title</button>`,
    `const b = document.getElementById("b");
     b.addEventListener("click", () => say("single click"));
     b.addEventListener("dblclick", async () => { await report("title-edited"); say("double clicked"); });`,
  ),
  "/checks": page(
    "Preferences",
    `<label><input type="checkbox" id="sub" checked> Subscribe to news</label>`,
    `document.getElementById("sub").addEventListener("change", async (e) => {
       await report(e.target.checked ? "subscribed" : "unsubscribed");
       say(e.target.checked ? "Subscribed" : "Unsubscribed"); });`,
  ),
  "/upload": page(
    "Upload",
    `<label>Attachment <input type="file" id="f"></label>`,
    `document.getElementById("f").addEventListener("change", async (e) => {
       const f = e.target.files[0];
       if (f) await report("upload:" + f.name);
       say(f ? "Received " + f.name + " (" + f.size + " bytes)" : "none"); });`,
  ),
  "/scroll": page(
    "Long page",
    `${Array.from({ length: 60 }, (_, i) => `<p>Section ${i + 1}</p>`).join("")}<div id="end">End of page</div>`,
    `new IntersectionObserver(async (es) => { if (es.some((e) => e.isIntersecting)) { await report("more-loaded"); say("More items loaded"); } })
       .observe(document.getElementById("end"));`,
  ),
  "/drag": page(
    "Drag and drop",
    `<span class="item" id="card" draggable="true">Card A</span>
     <div class="drop" id="zone">Drop zone</div>`,
    `const z = document.getElementById("zone");
     document.getElementById("card").addEventListener("dragstart", (e) => e.dataTransfer.setData("text", "A"));
     z.addEventListener("dragover", (e) => e.preventDefault());
     z.addEventListener("drop", async (e) => { e.preventDefault(); const v = e.dataTransfer.getData("text"); await report("dropped:" + v); say("Dropped " + v); });`,
  ),
  "/dialog": page(
    "Delete item",
    `<button id="del">Delete item</button>`,
    `document.getElementById("del").addEventListener("click", async () => {
       if (confirm("Really delete?")) { await report("deleted"); say("Deleted"); } else say("Cancelled"); });`,
  ),
  "/popup": page("Orders", `<a href="/receipt" target="_blank" rel="opener">Open receipt</a>`),
  "/receipt": page("Receipt 42", `<p>Total: 12 EUR</p>`, `report("receipt-viewed");`),
  "/frame": page(
    "Checkout",
    `<iframe src="/frame-inner" title="payment" style="width:360px;height:140px"></iframe>`,
  ),
  "/frame-inner": page(
    "Card form",
    `<label>Card number <input id="card"></label><button id="pay">Pay</button>`,
    `document.getElementById("pay").addEventListener("click", async () => {
       const v = document.getElementById("card").value; await report("paid:" + v); say("Paid with " + v); });`,
  ),
  "/nav": page("Start", `<a href="/nav2">Next page</a>`, `report("nav-loaded");`),
  "/nav2": page("Second page", `<p>You are on page two</p>`, `report("nav2-loaded");`),
};

export interface WidgetsVariant {
  /** "silent": answers 200 but records nothing. "error": answers 500. The UI reports success either way. */
  bug?: "silent" | "error";
}

export class WidgetsServer {
  private server?: http.Server;
  private readonly events: string[] = [];
  private postCount = 0;
  constructor(private readonly variant: WidgetsVariant = {}) {}

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path === "/api/events" && req.method === "GET") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(this.events.map((type) => ({ type }))));
        return;
      }
      if (path === "/api/event" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          this.postCount++;
          if (this.variant.bug === "error") {
            res.writeHead(500, { "content-type": "application/json" }).end('{"error":"boom"}');
            return;
          }
          if (this.variant.bug !== "silent") {
            try {
              this.events.push(String((JSON.parse(body) as { type?: string }).type ?? ""));
            } catch {
              /* malformed body: not recorded */
            }
          }
          res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        });
        return;
      }
      const html = PAGES[path];
      if (!html) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Server-side truth; shaped like the shop oracle so one harness serves both fixtures. */
  async oracle(): Promise<OracleState> {
    return {
      orders: [],
      viewed: [],
      postCount: this.postCount,
      rows: [],
      deletedRows: [],
      leaks: 0,
      upgrades: 0,
      events: [...this.events],
    };
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections?.();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
