/**
 * lib/scanner/protocols/websocket.ts is pure logic over a URL string and an
 * optional Headers object (the caller is responsible for actually opening
 * the WS connection elsewhere) — no network I/O here, so no boundary to mock.
 */
import { describe, it, expect } from "vitest";
import {
  runWebSocketChecks,
  isWebSocketCheck,
  getWebSocketCategories,
  WEBSOCKET_CHECK_IDS,
  WEBSOCKET_CATEGORIES,
} from "@/lib/scanner/protocols/websocket";

describe("runWebSocketChecks", () => {
  it("flags plain ws:// as insecure", () => {
    const findings = runWebSocketChecks("ws://chat.example.com/socket");
    const insecure = findings.find(
      (f) => f.id.split("--")[0] === "ws-insecure-connection",
    );
    expect(insecure).toBeDefined();
    expect(insecure?.severity).toBe("high");
  });

  it("does not flag wss:// as insecure", () => {
    const findings = runWebSocketChecks("wss://chat.example.com/socket");
    const insecure = findings.find(
      (f) => f.id.split("--")[0] === "ws-insecure-connection",
    );
    expect(insecure).toBeUndefined();
  });

  it("returns no findings for wss:// with no headers supplied", () => {
    expect(runWebSocketChecks("wss://chat.example.com/socket")).toEqual([]);
  });

  it("flags a wildcard Access-Control-Allow-Origin header", () => {
    const headers = new Headers({ "access-control-allow-origin": "*" });
    const findings = runWebSocketChecks("wss://chat.example.com/", headers);
    const cors = findings.find(
      (f) => f.id.split("--")[0] === "ws-cors-wildcard",
    );
    expect(cors).toBeDefined();
    expect(cors?.severity).toBe("medium");
  });

  it("does not flag a specific (non-wildcard) origin", () => {
    const headers = new Headers({
      "access-control-allow-origin": "https://trusted.example.com",
    });
    const findings = runWebSocketChecks("wss://chat.example.com/", headers);
    expect(
      findings.find((f) => f.id.split("--")[0] === "ws-cors-wildcard"),
    ).toBeUndefined();
  });

  it("flags permessage-deflate compression as an info-level finding", () => {
    const headers = new Headers({
      "sec-websocket-extensions": "permessage-deflate; client_max_window_bits",
    });
    const findings = runWebSocketChecks("wss://chat.example.com/", headers);
    const compression = findings.find(
      (f) => f.id.split("--")[0] === "ws-compression",
    );
    expect(compression).toBeDefined();
    expect(compression?.severity).toBe("info");
  });

  it("does not flag compression when the extension header is absent", () => {
    const headers = new Headers();
    const findings = runWebSocketChecks("wss://chat.example.com/", headers);
    expect(
      findings.find((f) => f.id.split("--")[0] === "ws-compression"),
    ).toEqual(undefined);
  });

  it("combines insecure-protocol and header findings for a plain ws:// with wildcard CORS", () => {
    const headers = new Headers({ "access-control-allow-origin": "*" });
    const findings = runWebSocketChecks("ws://chat.example.com/", headers);
    expect(findings).toHaveLength(2);
  });
});

describe("isWebSocketCheck", () => {
  it("recognizes every declared WebSocket check id", () => {
    for (const id of WEBSOCKET_CHECK_IDS) {
      expect(isWebSocketCheck(id)).toBe(true);
    }
  });

  it("rejects a check id from another protocol", () => {
    expect(isWebSocketCheck("ftp-anonymous-access")).toBe(false);
  });
});

describe("getWebSocketCategories", () => {
  it("includes ssl for wss (secure)", () => {
    expect(getWebSocketCategories(true)).toEqual(WEBSOCKET_CATEGORIES);
    expect(getWebSocketCategories(true)).toContain("ssl");
  });

  it("excludes ssl for plain ws", () => {
    const cats = getWebSocketCategories(false);
    expect(cats).not.toContain("ssl");
    expect(cats).toContain("headers");
  });
});
