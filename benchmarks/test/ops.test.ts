import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightAdapter } from "@vedha/adapter-playwright";
import { Session } from "@vedha/core";
import type { ActionSpec, Policy } from "@vedha/core";
import { WidgetsServer } from "../fixtures/widgets.js";

let server: WidgetsServer;
let base: string;
beforeAll(async () => {
  server = new WidgetsServer();
  base = await server.start();
});
afterAll(async () => {
  await server.stop();
});

async function withSession<T>(
  path0: string,
  policy: Policy,
  fn: (s: Session) => Promise<T>,
): Promise<T> {
  const adapter = await PlaywrightAdapter.launch();
  const s = await Session.create(adapter, policy);
  try {
    await s.step({ id: "open", intent: "open", op: "goto", value: base + path0 });
    return await fn(s);
  } finally {
    await s.close();
  }
}

const status = (contains: string) =>
  ({ type: "text", target: { role: "status" }, contains }) as const;
const step = (id: string, extra: Partial<ActionSpec> & Pick<ActionSpec, "op">): ActionSpec => ({
  id,
  intent: id,
  timeoutMs: 3000,
  ...extra,
});

describe("extended ops (real browser)", () => {
  it("hover reveals a menu that was hidden, then click works", async () => {
    await withSession("/hover", {}, async (s) => {
      const hidden = await s.step(
        step("too-early", {
          op: "click",
          target: { role: "button", name: "Laptops" },
          timeoutMs: 500,
        }),
      );
      expect(hidden.status).toBe("failed");
      expect(hidden.error?.hint).toBeTruthy();
      await s.step(step("hover", { op: "hover", target: { text: "Products" } }));
      const r = await s.step(
        step("pick", {
          op: "click",
          target: { role: "button", name: "Laptops" },
          postconditions: [status("Laptops opened")],
        }),
      );
      expect(r.status).toBe("verified");
    });
  }, 60_000);

  it("dblclick fires the double-click handler", async () => {
    await withSession("/dblclick", {}, async (s) => {
      const r = await s.step(
        step("dbl", {
          op: "dblclick",
          target: { role: "button", name: "Edit title" },
          postconditions: [status("double clicked")],
        }),
      );
      expect(r.status).toBe("verified");
    });
  }, 60_000);

  it("uncheck flips a checked box", async () => {
    await withSession("/checks", {}, async (s) => {
      const r = await s.step(
        step("off", {
          op: "uncheck",
          target: { label: "Subscribe to news" },
          postconditions: [status("Unsubscribed")],
        }),
      );
      expect(r.status).toBe("verified");
    });
  }, 60_000);

  it("scroll to the bottom triggers lazy loading", async () => {
    await withSession("/scroll", {}, async (s) => {
      const r = await s.step(
        step("bottom", {
          op: "scroll",
          value: "bottom",
          postconditions: [status("More items loaded")],
        }),
      );
      expect(r.status).toBe("verified");
    });
  }, 60_000);

  it("drag moves an item onto a drop zone", async () => {
    await withSession("/drag", {}, async (s) => {
      const r = await s.step(
        step("drag", {
          op: "drag",
          target: { text: "Card A" },
          to: { text: "Drop zone" },
          postconditions: [status("Dropped A")],
        }),
      );
      expect(r.status).toBe("verified");
    });
  }, 60_000);

  it("dialogs are dismissed by default, accepted on request, and always reported", async () => {
    const click = step("del", {
      op: "click",
      target: { role: "button", name: "Delete item" },
      mutating: true,
    });
    await withSession("/dialog", {}, async (s) => {
      const r = await s.step({ ...click, postconditions: [status("Cancelled")] });
      expect(r.status).toBe("verified");
      expect(r.observed?.join(" ")).toContain("Really delete?");
    });
    await withSession("/dialog", { dialogs: "accept" }, async (s) => {
      const r = await s.step({ ...click, postconditions: [status("Deleted")] });
      expect(r.status).toBe("verified");
    });
  }, 60_000);

  it("a link that opens a new tab is reported, and switch_tab moves to it", async () => {
    await withSession("/popup", {}, async (s) => {
      const open = await s.step(
        step("open", { op: "click", target: { role: "link", name: "Open receipt" } }),
      );
      expect(open.observed?.join(" ")).toContain("new tab opened");
      const sw = await s.step(step("sw", { op: "switch_tab", value: "last" }));
      expect(sw.status).toBe("unverified");
      const obs = await s.observe();
      expect(obs.outline).toContain("Receipt 42");
    });
  }, 60_000);

  it("reports the tab list, a 404 main document and console errors in the page header", async () => {
    await withSession("/popup", {}, async (s) => {
      await s.step(step("open", { op: "click", target: { role: "link", name: "Open receipt" } }));
      await s.step(step("sw", { op: "switch_tab", value: "last" }));
      const obs = await s.observe();
      expect(obs.header?.tabs).toHaveLength(2);
      expect(obs.header?.tabs.find((t) => t.current)?.url).toContain("/receipt");
      await s.step(step("missing", { op: "goto", value: base + "/nope" }));
      const bad = await s.observe();
      expect(bad.header?.mainStatus).toBe(404);
      const adapter = s.adapter as unknown as {
        page: { evaluate: (f: () => void) => Promise<void> };
      };
      await adapter.page.evaluate(() => console.error("boom"));
      await new Promise((r) => setTimeout(r, 200));
      expect((await s.observe()).header?.consoleErrors).toBeGreaterThanOrEqual(1);
    });
  }, 60_000);

  it("targets elements inside an iframe", async () => {
    await withSession("/frame", {}, async (s) => {
      const frame = "iframe[title=payment]";
      await s.step(
        step("card", {
          op: "fill",
          target: { inFrame: frame, target: { label: "Card number" } },
          value: "4242",
        }),
      );
      const r = await s.step(
        step("pay", {
          op: "click",
          target: { inFrame: frame, target: { role: "button", name: "Pay" } },
          postconditions: [
            {
              type: "text",
              target: { inFrame: frame, target: { role: "status" } },
              contains: "Paid with 4242",
            },
          ],
        }),
      );
      expect(r.status).toBe("verified");
    });
  }, 60_000);

  it("back returns to the previous page", async () => {
    await withSession("/nav", {}, async (s) => {
      await s.step(
        step("next", {
          op: "click",
          target: { role: "link", name: "Next page" },
          postconditions: [{ type: "url", matches: "/nav2" }],
        }),
      );
      const r = await s.step(
        step("back", { op: "back", postconditions: [{ type: "url", matches: "/nav" }] }),
      );
      expect(r.status).toBe("verified");
    });
  }, 60_000);

  it("upload is refused unless the file is inside policy.uploadRoots", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vedha-up-"));
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "hello");
    const up = step("up", { op: "upload", target: { label: "Attachment" }, value: file });
    await withSession("/upload", {}, async (s) => {
      const r = await s.step(up);
      expect(r.status).toBe("blocked");
      expect(r.error?.message).toContain("uploads are disabled");
    });
    await withSession("/upload", { uploadRoots: [os.tmpdir()] }, async (s) => {
      const outside = await s.step({ ...up, id: "out", value: "/etc/hosts" });
      expect(outside.status).toBe("blocked");
      const r = await s.step({ ...up, postconditions: [status("Received a.txt (5 bytes)")] });
      expect(r.status).toBe("verified");
    });
  }, 60_000);
});

describe("a passed UI check does not hide a write the server did not keep (real browser)", () => {
  async function pressEscape(bug?: "silent") {
    const srv = new WidgetsServer(bug ? { bug } : {});
    const url = await srv.start();
    const adapter = await PlaywrightAdapter.launch();
    const s = await Session.create(adapter, {});
    try {
      await s.step({ id: "open", intent: "open", op: "goto", value: url + "/keys" });
      return await s.step(
        step("close", {
          op: "press",
          value: "Escape",
          postconditions: [
            { type: "state", target: { role: "dialog", name: "Help panel" }, state: "hidden" },
          ],
        }),
      );
    } finally {
      await s.close();
      await srv.stop();
    }
  }

  it("fails with a read-back contradiction when the server stored nothing", async () => {
    const r = await pressEscape("silent");
    expect(r.status).toBe("failed");
    expect(r.error?.code).toBe("readback_contradiction");
  }, 60_000);

  it("stays verified when the server stored the event", async () => {
    const r = await pressEscape();
    expect(r.status).toBe("verified");
  }, 60_000);
});
