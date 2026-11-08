import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import { createFrontServer, prepareStartEnv } from "@/server.mjs";
import {
  DEFAULT_TRUSTED_PROXY_CIDR,
  enforceForwardedFor,
  localPlainHttpApplies,
  proxyTrustWarning,
  trustedProxyCidr,
} from "@/lib/server/http-front.mjs";

/**
 * Next keeps an X-Forwarded-For the client sent (it only fills the header in
 * when it is absent), and getClientIp reads the right-most hop, so on any
 * deployment with no appending proxy one request header chose the IP that
 * rate limits, session binding and audit rows recorded. server.mjs sits in
 * front of Next and is the only code that can see the real socket.
 */

function requestFrom(
  remoteAddress: string | undefined,
  headers: Record<string, string> = {},
): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe("enforceForwardedFor", () => {
  const cidr = DEFAULT_TRUSTED_PROXY_CIDR;

  it("replaces a forged header with the socket address of an untrusted peer", () => {
    const req = requestFrom("203.0.113.9", { "x-forwarded-for": "1.1.1.1" });
    enforceForwardedFor(req, cidr);
    expect(req.headers["x-forwarded-for"]).toBe("203.0.113.9");
  });

  it("gives an untrusted peer the header even when it sent none", () => {
    const req = requestFrom("203.0.113.9");
    enforceForwardedFor(req, cidr);
    expect(req.headers["x-forwarded-for"]).toBe("203.0.113.9");
  });

  it("keeps the client IP a loopback proxy appended", () => {
    const req = requestFrom("127.0.0.1", {
      "x-forwarded-for": "1.1.1.1, 198.51.100.7",
    });
    enforceForwardedFor(req, cidr);
    expect(req.headers["x-forwarded-for"]).toBe("1.1.1.1, 198.51.100.7");
  });

  it("keeps the header from the Docker bridge gateway", () => {
    for (const peer of ["172.17.0.1", "172.31.255.1", "192.168.16.1"]) {
      const req = requestFrom(peer, { "x-forwarded-for": "198.51.100.7" });
      enforceForwardedFor(req, cidr);
      expect(req.headers["x-forwarded-for"], peer).toBe("198.51.100.7");
    }
  });

  it("reads through the IPv4-mapped form a dual-stack socket reports", () => {
    const trusted = requestFrom("::ffff:127.0.0.1", {
      "x-forwarded-for": "198.51.100.7",
    });
    enforceForwardedFor(trusted, cidr);
    expect(trusted.headers["x-forwarded-for"]).toBe("198.51.100.7");

    const outside = requestFrom("::ffff:203.0.113.9", {
      "x-forwarded-for": "1.1.1.1",
    });
    enforceForwardedFor(outside, cidr);
    expect(outside.headers["x-forwarded-for"]).toBe("203.0.113.9");
  });

  it("trusts the IPv6 loopback", () => {
    const req = requestFrom("::1", { "x-forwarded-for": "198.51.100.7" });
    enforceForwardedFor(req, cidr);
    expect(req.headers["x-forwarded-for"]).toBe("198.51.100.7");
  });

  it("drops the other client-IP headers getClientIp falls back to", () => {
    const req = requestFrom("203.0.113.9", {
      "x-real-ip": "1.1.1.1",
      "cf-connecting-ip": "1.0.0.1",
    });
    enforceForwardedFor(req, cidr);
    expect(req.headers["x-real-ip"]).toBeUndefined();
    expect(req.headers["cf-connecting-ip"]).toBeUndefined();
  });

  it("removes the header rather than keep it when the socket has already gone", () => {
    const req = requestFrom(undefined, { "x-forwarded-for": "1.1.1.1" });
    enforceForwardedFor(req, cidr);
    expect(req.headers["x-forwarded-for"]).toBeUndefined();
  });

  it("treats an operator list as the whole list, not an addition", () => {
    const bridge = requestFrom("172.17.0.1", { "x-forwarded-for": "1.1.1.1" });
    enforceForwardedFor(bridge, "10.0.0.0/8");
    expect(bridge.headers["x-forwarded-for"]).toBe("172.17.0.1");

    const listed = requestFrom("10.1.2.3", {
      "x-forwarded-for": "198.51.100.7",
    });
    enforceForwardedFor(listed, "10.0.0.0/8");
    expect(listed.headers["x-forwarded-for"]).toBe("198.51.100.7");
  });

  it("believes a same-host proxy when the operator's list leaves loopback out", () => {
    // The example in .env.example and the self-hosting docs has no 127.0.0.0/8
    // in it, because the list used to mean hops inside the header and a proxy
    // on this machine is never one of those.
    const documented = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";
    for (const peer of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) {
      const req = requestFrom(peer, { "x-forwarded-for": "198.51.100.7" });
      enforceForwardedFor(req, documented);
      expect(req.headers["x-forwarded-for"], peer).toBe("198.51.100.7");
    }
  });

  it("does not let an outside address pass for loopback", () => {
    for (const peer of ["128.0.0.1", "::2", "::ffff:128.0.0.1"]) {
      const req = requestFrom(peer, { "x-forwarded-for": "1.1.1.1" });
      enforceForwardedFor(req, "10.0.0.0/8");
      expect(req.headers["x-forwarded-for"], peer).not.toBe("1.1.1.1");
    }
  });

  it("matches nothing on a prefix that is not a whole number", () => {
    // BigInt() throws on a fraction, so an IPv6 connection used to reject
    // inside the request listener, where nothing would answer it.
    const req = requestFrom("2001:db8::9", { "x-forwarded-for": "1.1.1.1" });
    expect(() => enforceForwardedFor(req, "2001:db8::/32.5")).not.toThrow();
    expect(req.headers["x-forwarded-for"]).toBe("2001:db8::9");
  });
});

describe("trustedProxyCidr", () => {
  it("defaults to loopback and the Docker bridge ranges", () => {
    expect(trustedProxyCidr({})).toBe(DEFAULT_TRUSTED_PROXY_CIDR);
    expect(trustedProxyCidr({ TRUSTED_PROXY_CIDR: "  " })).toBe(
      DEFAULT_TRUSTED_PROXY_CIDR,
    );
    expect(DEFAULT_TRUSTED_PROXY_CIDR).toContain("127.0.0.0/8");
    expect(DEFAULT_TRUSTED_PROXY_CIDR).toContain("::1/128");
    expect(DEFAULT_TRUSTED_PROXY_CIDR).toContain("172.16.0.0/12");
  });

  it("uses what the operator set", () => {
    expect(trustedProxyCidr({ TRUSTED_PROXY_CIDR: "10.0.0.0/8" })).toBe(
      "10.0.0.0/8",
    );
  });
});

describe("proxyTrustWarning", () => {
  it("warns when the port is published on every interface with no proxy named", () => {
    expect(proxyTrustWarning({ HOST_BIND: "0.0.0.0" })).toMatch(/HOST_BIND/);
    expect(proxyTrustWarning({ HOST_BIND: "::" })).toMatch(/HOST_BIND/);
  });

  it("warns when plain HTTP was turned on with no proxy named", () => {
    expect(proxyTrustWarning({ ALLOW_INSECURE_HTTP: "1" })).toMatch(
      /ALLOW_INSECURE_HTTP/,
    );
  });

  it("stays quiet once a trusted proxy is named", () => {
    expect(
      proxyTrustWarning({
        HOST_BIND: "0.0.0.0",
        ALLOW_INSECURE_HTTP: "1",
        TRUSTED_PROXY_CIDR: "10.0.0.0/8",
      }),
    ).toBeNull();
  });

  it("stays quiet on the default loopback quick start", () => {
    expect(
      proxyTrustWarning({ HOST_BIND: "127.0.0.1", ALLOW_INSECURE_HTTP: "1" }),
    ).toBeNull();
    expect(proxyTrustWarning({})).toBeNull();
  });
});

describe("localPlainHttpApplies", () => {
  const quickStart = {
    HOST_BIND: "127.0.0.1",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  };

  it("turns plain HTTP on for the compose quick start", () => {
    expect(localPlainHttpApplies(quickStart)).toBe(true);
  });

  it("leaves a loopback bind behind a TLS proxy alone", () => {
    // HOST_BIND=127.0.0.1 is also the documented production shape, with nginx
    // terminating TLS on the host. Plain HTTP there would take the Secure flag
    // off every session cookie and stop sending HSTS.
    expect(
      localPlainHttpApplies({
        HOST_BIND: "127.0.0.1",
        NEXT_PUBLIC_APP_URL: "https://scan.example.com",
      }),
    ).toBe(false);
  });

  it("follows APP_URL over the public variable, as the server does", () => {
    expect(
      localPlainHttpApplies({
        ...quickStart,
        APP_URL: "https://scan.example.com",
      }),
    ).toBe(false);
  });

  it("does nothing when the port is published to the network", () => {
    expect(localPlainHttpApplies({ ...quickStart, HOST_BIND: "0.0.0.0" })).toBe(
      false,
    );
  });

  it("does nothing outside compose, where HOST_BIND is not set", () => {
    expect(
      localPlainHttpApplies({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    ).toBe(false);
  });

  it("never overrides an explicit choice", () => {
    expect(
      localPlainHttpApplies({ ...quickStart, ALLOW_INSECURE_HTTP: "0" }),
    ).toBe(false);
  });

  it("does not read a malformed URL as local", () => {
    expect(
      localPlainHttpApplies({ HOST_BIND: "127.0.0.1", APP_URL: "not a url" }),
    ).toBe(false);
  });
});

describe("prepareStartEnv", () => {
  it("hands signal handling to the shutdown sequence", () => {
    const env: Record<string, string | undefined> = {};
    prepareStartEnv(env);
    expect(env.NEXT_MANUAL_SIG_HANDLE).toBe("1");
  });

  it("defaults to production and keeps a value already set", () => {
    const blank: Record<string, string | undefined> = {};
    prepareStartEnv(blank);
    expect(blank.NODE_ENV).toBe("production");

    const test: Record<string, string | undefined> = { NODE_ENV: "test" };
    prepareStartEnv(test);
    expect(test.NODE_ENV).toBe("test");
  });

  it("turns plain HTTP on only for the local quick start", () => {
    const quickStart: Record<string, string | undefined> = {
      HOST_BIND: "127.0.0.1",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    };
    prepareStartEnv(quickStart);
    expect(quickStart.ALLOW_INSECURE_HTTP).toBe("1");

    const behindTls: Record<string, string | undefined> = {
      HOST_BIND: "127.0.0.1",
      NEXT_PUBLIC_APP_URL: "https://scan.example.com",
    };
    prepareStartEnv(behindTls);
    expect(behindTls.ALLOW_INSECURE_HTTP).toBeUndefined();
  });
});

describe("createFrontServer, over a real socket", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running) await new Promise((done) => running.close(done));
  });

  async function echoForwardedFor(
    env: Record<string, string | undefined>,
    sent: string,
    peer?: string,
  ): Promise<string> {
    server = createFrontServer(
      () => (req: IncomingMessage, res: http.ServerResponse) => {
        res.end(String(req.headers["x-forwarded-for"]));
      },
      env,
    );
    if (peer) {
      // A test can only connect from loopback, and that is always believed.
      server.prependListener("connection", (socket) =>
        Object.defineProperty(socket, "remoteAddress", { value: peer }),
      );
    }
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    return new Promise((resolve, reject) => {
      http
        .get(
          {
            port,
            host: "127.0.0.1",
            agent: false,
            headers: { "x-forwarded-for": sent },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve(body));
          },
        )
        .on("error", reject);
    });
  }

  it("keeps what a loopback peer sent under the default list", async () => {
    await expect(echoForwardedFor({}, "198.51.100.7")).resolves.toBe(
      "198.51.100.7",
    );
  });

  it("rewrites what a peer outside the list sent", async () => {
    await expect(
      echoForwardedFor(
        { TRUSTED_PROXY_CIDR: "10.0.0.0/8" },
        "1.1.1.1",
        "203.0.113.9",
      ),
    ).resolves.toBe("203.0.113.9");
  });

  it("answers 500 instead of hanging when the handler throws", async () => {
    server = createFrontServer(
      () => async () => {
        throw new Error("render failed");
      },
      {},
    );
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const status = await new Promise<number | undefined>(
        (resolve, reject) => {
          http
            .get(
              {
                port,
                host: "127.0.0.1",
                agent: false,
                path: "/reset-password/abc123?token=live-reset-token",
              },
              (res) => {
                res.resume();
                res.on("end", () => resolve(res.statusCode));
              },
            )
            .on("error", reject);
        },
      );
      expect(status).toBe(500);
      // Every console.error is persisted to the error log staff can read.
      expect(logged).toHaveBeenCalled();
      expect(JSON.stringify(logged.mock.calls)).not.toMatch(
        /live-reset-token|abc123/,
      );
    } finally {
      logged.mockRestore();
    }
  });
});
