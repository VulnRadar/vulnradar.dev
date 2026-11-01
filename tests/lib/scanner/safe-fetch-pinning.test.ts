import http from "node:http";
import https from "node:https";
import net from "node:net";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// These tests run the real global fetch against real sockets on 127.0.0.1. The
// rest of the safeFetch suite stubs fetch, which proves the redirect loop but
// says nothing about where the socket goes: the bug this file covers lived
// entirely below that stub. A pinned request used to be a URL rewritten to the
// IP, so plain HTTP went out with the IP as its Host, and HTTPS kept the name
// and let the connect re-resolve it, so a rebinding nameserver chose the
// address after validateScanTarget had approved another one.

const mockLookup = vi.fn();
vi.mock("dns/promises", () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

const { pinToResolvedIp, safeFetch } = await import("@/lib/scanner/safe-fetch");

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  return (server.address() as AddressInfo).port;
}

const open: net.Server[] = [];

async function httpServer(handler: Handler) {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url} host=${req.headers.host}`);
    handler(req, res);
  });
  open.push(server);
  const port = await listen(server);
  return { server, port, hits };
}

afterEach(async () => {
  for (const server of open.splice(0)) {
    if (server instanceof http.Server) server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
});

/** The server_name a TLS ClientHello asked for, or null when it sent none. */
function sniOf(hello: Buffer): string | null {
  // record header (5), handshake header (4), client_version (2), random (32)
  let p = 5 + 4 + 2 + 32;
  p += 1 + hello[p]; // session id
  p += 2 + hello.readUInt16BE(p); // cipher suites
  p += 1 + hello[p]; // compression methods
  const end = p + 2 + hello.readUInt16BE(p);
  p += 2;
  while (p + 4 <= end) {
    const type = hello.readUInt16BE(p);
    const len = hello.readUInt16BE(p + 2);
    p += 4;
    if (type === 0) {
      // server_name_list length (2), name_type (1), host_name length (2)
      const nameLen = hello.readUInt16BE(p + 3);
      return hello.subarray(p + 5, p + 5 + nameLen).toString("ascii");
    }
    p += len;
  }
  return null;
}

/** A TCP listener that records the SNI of every ClientHello and hangs up. */
async function clientHelloRecorder() {
  const names: (string | null)[] = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 5) return;
      if (buf.length < 5 + buf.readUInt16BE(3)) return;
      names.push(sniOf(buf));
      socket.destroy();
    });
    socket.on("error", () => {});
  });
  open.push(server);
  const port = await listen(server);
  return { port, names };
}

describe("pinToResolvedIp sends the request to the approved address under its own name", () => {
  it("plain HTTP: the server sees the hostname and port in Host, not the IP", async () => {
    const { port } = await httpServer((req, res) => {
      res.end(String(req.headers.host));
    });
    const url = `http://vhost.example:${port}/`;

    const target = pinToResolvedIp(url, "127.0.0.1", {});
    const res = await fetch(target.url, target.init);

    expect(await res.text()).toBe(`vhost.example:${port}`);
    expect(res.url).toBe(url);
  });

  it("HTTPS: the socket goes to the approved address and SNI names the host", async () => {
    // "vhost.example" resolves nowhere, so the only way a ClientHello reaches
    // this listener is the socket being dialled to the pinned address.
    const { port, names } = await clientHelloRecorder();
    const url = `https://vhost.example:${port}/`;

    const target = pinToResolvedIp(url, "127.0.0.1", {});
    await expect(fetch(target.url, target.init)).rejects.toThrow();

    expect(names).toEqual(["vhost.example"]);
  });

  it("keeps the body, method, compression and repeated Set-Cookie that fetch gives", async () => {
    const { port } = await httpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/"]);
        res.setHeader("content-encoding", "gzip");
        res.setHeader("content-type", "text/plain");
        res.end(gzipSync(`${req.method} ${body}`));
      });
    });

    const target = pinToResolvedIp(
      `http://vhost.example:${port}/form`,
      "127.0.0.1",
      {
        method: "POST",
        body: "x=1&y=2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
    );
    const res = await fetch(target.url, target.init);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("POST x=1&y=2");
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("streams a long upload without leaving a listener behind per wait for the socket", async () => {
    // Every chunk is larger than the request's buffer, so each write waits
    // for drain. Each wait used to leave its close listener on the request,
    // and the eleventh tripped MaxListenersExceededWarning.
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.name);
    process.on("warning", onWarning);
    const { port } = await httpServer((req, res) => {
      let received = 0;
      req.on("data", (c: Buffer) => (received += c.length));
      req.on("end", () => res.end(String(received)));
    });
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 16) controller.enqueue(chunk);
        else controller.close();
      },
    });

    try {
      const target = pinToResolvedIp(
        `http://vhost.example:${port}/upload`,
        "127.0.0.1",
        { method: "POST", body, duplex: "half" } as RequestInit,
      );
      const res = await fetch(target.url, target.init);
      expect(await res.text()).toBe(String(16 * 64 * 1024));
      // emitWarning reports on a later tick.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }

    expect(warnings).not.toContain("MaxListenersExceededWarning");
  });

  it("follows a same-host redirect on the pinned address when the caller asks fetch to", async () => {
    const { port, hits } = await httpServer((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/next" }).end();
      } else {
        res.end("arrived");
      }
    });

    const target = pinToResolvedIp(
      `http://vhost.example:${port}/start`,
      "127.0.0.1",
      {
        redirect: "follow",
      },
    );
    const res = await fetch(target.url, target.init);

    expect(await res.text()).toBe("arrived");
    expect(hits).toEqual([
      `GET /start host=vhost.example:${port}`,
      `GET /next host=vhost.example:${port}`,
    ]);
  });

  it("refuses to carry a pinned address over to a different host", async () => {
    // The address was approved for vhost.example. A followed redirect to
    // another name must not reuse it (that would send other.example's request
    // to vhost.example's server), and must not resolve the new name either.
    const { port, hits } = await httpServer((_req, res) => {
      res.writeHead(302, { location: `http://other.example:${port}/` }).end();
    });

    const target = pinToResolvedIp(
      `http://vhost.example:${port}/`,
      "127.0.0.1",
      {
        redirect: "follow",
      },
    );
    await expect(fetch(target.url, target.init)).rejects.toThrow();

    expect(hits).toHaveLength(1);
  });

  it("closes the socket when the caller aborts in the middle of the body", async () => {
    let serverSocketClosed!: Promise<void>;
    const { port } = await httpServer((req, res) => {
      serverSocketClosed = new Promise((resolve) =>
        req.socket.once("close", () => resolve()),
      );
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("first chunk, and then nothing");
    });
    const caller = new AbortController();

    const target = pinToResolvedIp(
      `http://vhost.example:${port}/`,
      "127.0.0.1",
      {
        signal: caller.signal,
      },
    );
    const res = await fetch(target.url, target.init);
    const reading = res.text();
    caller.abort(new Error("caller gave up"));

    await expect(reading).rejects.toThrow();
    // The point: the connection is torn down, not left open with nobody
    // reading it until the server gives up.
    await serverSocketClosed;
  });
});

describe("safeFetch dials only the address validateScanTarget approved", () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  /** Record every socket the default agents open, and refuse each one. */
  function recordDials() {
    const dials: { host?: string; servername?: string }[] = [];
    const refuse = (options: { host?: string; servername?: string }) => {
      dials.push({ host: options.host, servername: options.servername });
      const socket = new net.Socket();
      process.nextTick(() =>
        socket.destroy(
          Object.assign(new Error(`connect ECONNREFUSED ${options.host}`), {
            code: "ECONNREFUSED",
          }),
        ),
      );
      return socket;
    };
    vi.spyOn(https.globalAgent, "createConnection").mockImplementation(
      refuse as never,
    );
    vi.spyOn(http.globalAgent, "createConnection").mockImplementation(
      refuse as never,
    );
    return dials;
  }

  it("a name that answers a public address and then a private one is only ever dialled at the first", async () => {
    // The rebinding shape: the first answer passes validateScanTarget, every
    // later answer points inside. Nothing after the check may resolve the
    // name again, so 10.0.0.5 never reaches a socket.
    mockLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const dials = recordDials();

    await expect(safeFetch("https://rebind.example/")).rejects.toMatchObject({
      code: "unreachable",
    });

    expect(dials).toEqual([
      { host: "93.184.216.34", servername: "rebind.example" },
    ]);
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it("plain HTTP is dialled at the approved address too", async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const dials = recordDials();

    await expect(safeFetch("http://rebind.example/")).rejects.toMatchObject({
      code: "unreachable",
    });

    expect(dials.map((d) => d.host)).toEqual(["93.184.216.34"]);
  });
});
