import { describe, expect, it } from "vitest";
import {
  failedRequestFinding,
  guardError,
  pageErrorFinding,
  resolveGuard,
  responseFinding,
  siteOf,
  watched,
} from "../src/guard.js";

const def = resolveGuard(true)!;
const strict = resolveGuard("strict")!;

describe("guard rules", () => {
  it("is off with false, warns on 4xx writes and page errors by default, fails on them when strict", () => {
    expect(resolveGuard(false)).toBeUndefined();
    expect(def.rejectedWrites).toBe("warn");
    expect(def.pageErrors).toBe("warn");
    expect(strict.rejectedWrites).toBe("fail");
    expect(strict.pageErrors).toBe("fail");
    expect(resolveGuard({ pageErrors: "fail" })!.rejectedWrites).toBe("warn");
  });

  it("fails any 5xx, grades 4xx only on writes, ignores successes", () => {
    expect(responseFinding("POST", "http://a.test/api/orders", 500, def)).toEqual({
      level: "fail",
      message: "POST /api/orders returned 500",
    });
    expect(responseFinding("GET", "http://a.test/api/items", 503, def)?.level).toBe("fail");
    expect(responseFinding("POST", "http://a.test/api/orders", 422, def)?.level).toBe("warn");
    expect(responseFinding("POST", "http://a.test/api/orders", 422, strict)?.level).toBe("fail");
    expect(responseFinding("GET", "http://a.test/missing", 404, def)).toBeUndefined();
    expect(responseFinding("POST", "http://a.test/api/orders", 201, def)).toBeUndefined();
  });

  it("fails a write that never got an answer, but not reads or navigation aborts", () => {
    expect(
      failedRequestFinding("PUT", "http://a.test/api/x", "net::ERR_CONNECTION_RESET")?.level,
    ).toBe("fail");
    expect(
      failedRequestFinding("GET", "http://a.test/api/x", "net::ERR_CONNECTION_RESET"),
    ).toBeUndefined();
    expect(failedRequestFinding("POST", "http://a.test/api/x", "net::ERR_ABORTED")).toBeUndefined();
  });

  it("watches the page's own site and listed hosts, skips third parties and ignored URLs", () => {
    const page = "https://shop.example.com/cart";
    expect(siteOf("api.shop.example.com")).toBe("example.com");
    expect(siteOf("127.0.0.1")).toBe("127.0.0.1");
    expect(watched("https://api.example.com/orders", page, def)).toBe(true);
    expect(watched("https://analytics.vendor.io/collect", page, def)).toBe(false);
    expect(watched("https://api.other.io/orders", page, { ...def, hosts: ["api.other.io"] })).toBe(
      true,
    );
    expect(watched("https://api.example.com/flaky", page, { ...def, ignore: ["/flaky"] })).toBe(
      false,
    );
    expect(watched("https://api.example.com/v2/x", page, { ...def, ignore: [/\/v2\//] })).toBe(
      false,
    );
    expect(watched("data:text/plain,x", page, def)).toBe(false);
    expect(watched("https://api.example.com/orders", undefined, def)).toBe(false);
  });

  it("explains the failure and how to accept an expected one", () => {
    const msg = guardError([
      { level: "fail", message: "POST /api/orders returned 500" },
      { level: "fail", message: "POST /api/orders returned 500" },
    ]).message;
    expect(msg).toContain("the test's own checks passed");
    expect(msg.match(/POST \/api\/orders returned 500/g)).toHaveLength(1);
    expect(msg).toContain("vedhaGuard");
    expect(pageErrorFinding("boom", def)).toEqual({
      level: "warn",
      message: "uncaught page error: boom",
    });
  });
});
