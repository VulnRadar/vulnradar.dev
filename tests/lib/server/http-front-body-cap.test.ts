import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createFrontServer } from "@/server.mjs";
import {
  MAX_REQUEST_BODY_BYTES as FRONT_CAP,
  capRequestBody,
} from "@/lib/server/http-front.mjs";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/api/request-limits";

/**
 * Middleware refuses a body by its declared Content-Length only, and a
 * chunked upload declares none, so a route that calls request.json() itself
 * buffered whatever the client kept sending. server.mjs is the one place that
 * sees the bytes arrive for every request, which is where they are counted.
 *
 * Every case here runs over a real socket: what is being proved is how the
 * IncomingMessage Next receives behaves, which a fake request cannot show.
 */

interface Seen {
  bytes: number;
  ended: boolean;
  hash: string;
  closed: Promise<void>;
}

let server: http.Server | undefined;

afterEach(async () => {
  const running = server;
  server = undefined;
  if (running) {
    running.closeAllConnections();
    await new Promise((done) => running.close(done));
  }
});

/**
 * Reads the body the way Next does (it clones the stream for middleware as
 * soon as the request arrives), and answers only once it has all of it.
 */
function readingHandler(seen: Seen[]) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const hash = createHash("sha256");
    let closeDone!: () => void;
    const entry: Seen = {
      bytes: 0,
      ended: false,
      hash: "",
      closed: new Promise<void>((done) => (closeDone = done)),
    };
    seen.push(entry);
    req.on("data", (chunk: Buffer) => {
      entry.bytes += chunk.length;
      hash.update(chunk);
    });
    req.on("end", () => {
      entry.ended = true;
      entry.hash = hash.digest("hex");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ bytes: entry.bytes, hash: entry.hash }));
    });
    req.on("error", () => {});
    req.on("close", () => closeDone());
  };
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<number> {
  server = createFrontServer(() => handler, {});
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  return (server.address() as AddressInfo).port;
}

interface Answer {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Sends `body` in 64 KiB writes and stops writing as soon as an answer comes
 * back, the way curl and browsers stop an upload the server has refused.
 */
function send(
  port: number,
  path: string,
  body: Buffer,
  options: { declareLength?: boolean } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let answered = false;
    const headers: Record<string, string | number> = {
      "content-type": "application/json",
    };
    if (options.declareLength) headers["content-length"] = body.length;
    const req = http.request(
      { port, host: "127.0.0.1", agent: false, method: "POST", path, headers },
      (res) => {
        answered = true;
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body: text });
          req.destroy();
        });
      },
    );
    // Once the server has answered, a write failing on the closed socket is
    // the expected end of a refused upload, not a test failure.
    req.on("error", (err) => {
      if (!answered) reject(err);
    });

    const CHUNK = 64 * 1024;
    let offset = 0;
    const pump = () => {
      while (offset < body.length && !answered && !req.destroyed) {
        const slice = body.subarray(offset, offset + CHUNK);
        offset += slice.length;
        if (!req.write(slice)) {
          req.once("drain", pump);
          return;
        }
      }
      if (offset >= body.length && !answered && !req.destroyed) req.end();
    };
    pump();
  });
}

const MiB = 1024 * 1024;

describe("the front server's copy of the body cap", () => {
  it("is the cap the middleware and the bounded readers enforce", () => {
    expect(FRONT_CAP).toBe(MAX_REQUEST_BODY_BYTES);
  });
});

describe("a chunked body to the API, over a real socket", () => {
  for (const path of ["/api/v3/contact", "/api/v3/account/unsubscribe"]) {
    it(`refuses 2 MiB to ${path} with a 413 before the handler sees the end`, async () => {
      const seen: Seen[] = [];
      const port = await listen(readingHandler(seen));

      const answer = await send(port, path, randomBytes(2 * MiB));

      expect(answer.status).toBe(413);
      expect(answer.headers["content-type"]).toMatch(/^application\/json/);
      expect(answer.headers["cache-control"]).toBe("no-store");
      const parsed = JSON.parse(answer.body) as Record<string, unknown>;
      expect(parsed).toEqual({
        error: `Request body exceeds the ${MAX_REQUEST_BODY_BYTES} byte limit.`,
        code: "PAYLOAD_TOO_LARGE",
        requestId: expect.any(String),
      });
      expect(answer.headers["x-request-id"]).toBe(parsed.requestId);

      expect(seen).toHaveLength(1);
      await seen[0].closed;
      expect(seen[0].ended).toBe(false);
      expect(seen[0].bytes).toBeLessThanOrEqual(MAX_REQUEST_BODY_BYTES);
    });
  }

  it("hands a 900 KiB body to the handler whole and unchanged", async () => {
    const seen: Seen[] = [];
    const port = await listen(readingHandler(seen));
    const body = randomBytes(900 * 1024);

    const answer = await send(port, "/api/v3/contact", body);

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({
      bytes: body.length,
      hash: createHash("sha256").update(body).digest("hex"),
    });
  });

  it("lets exactly the cap through and refuses one byte more", async () => {
    const seen: Seen[] = [];
    const port = await listen(readingHandler(seen));

    const atCap = await send(
      port,
      "/api/v3/contact",
      randomBytes(MAX_REQUEST_BODY_BYTES),
    );
    expect(atCap.status).toBe(200);

    const over = await send(
      port,
      "/api/v3/contact",
      randomBytes(MAX_REQUEST_BODY_BYTES + 1),
    );
    expect(over.status).toBe(413);
  });

  it("counts an escaped spelling of the API prefix as the API", async () => {
    const seen: Seen[] = [];
    const port = await listen(readingHandler(seen));

    for (const path of [
      "/%61pi/v3/contact",
      "/x/../api/v3/contact",
      "/api/v3/contact?next=/",
      // The middleware unescapes the prefix one escape at a time, so a
      // malformed one further along does not stop it judging the API.
      "/%61pi/v3/contact/%zz",
    ]) {
      const answer = await send(port, path, randomBytes(2 * MiB));
      expect(answer.status, path).toBe(413);
    }
  });

  it("does not count a body sent to a page", async () => {
    const seen: Seen[] = [];
    const port = await listen(readingHandler(seen));
    const body = randomBytes(2 * MiB);

    const answer = await send(port, "/contact", body);

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({
      bytes: body.length,
      hash: createHash("sha256").update(body).digest("hex"),
    });
  });

  it("closes the connection when the handler had already started its answer", async () => {
    const port = await listen((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("streaming");
      req.on("data", () => {});
      req.on("end", () => res.end(" and done"));
      req.on("error", () => {});
    });

    const outcome = await new Promise<string>((resolve) => {
      const req = http.request(
        {
          port,
          host: "127.0.0.1",
          agent: false,
          method: "POST",
          path: "/api/v3/contact",
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve(`ended: ${text}`));
          res.on("error", () => resolve(`cut off: ${text}`));
          res.on("aborted", () => resolve(`cut off: ${text}`));
        },
      );
      req.on("error", () => {});
      const chunk = randomBytes(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 4 * MiB && !req.destroyed) {
          sent += chunk.length;
          if (!req.write(chunk)) {
            req.once("drain", pump);
            return;
          }
        }
        if (!req.destroyed) req.end();
      };
      pump();
    });

    expect(outcome).toBe("cut off: streaming");
  });
});

describe("a Content-Length sent beside Transfer-Encoding", () => {
  it("is counted when the lenient parser reads that body as chunked", async () => {
    // The strict parser refuses the pair outright. --insecure-http-parser
    // takes the chunked body and keeps the header, so a middleware that
    // judges the header sees 10 bytes while the handler receives them all.
    const seen: Seen[] = [];
    const handler = readingHandler(seen);
    server = http.createServer({ insecureHTTPParser: true }, (req, res) => {
      capRequestBody(req, res);
      handler(req, res);
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;

    const chunk = randomBytes(64 * 1024);
    const frames: Buffer[] = [
      Buffer.from(
        "POST /api/v3/contact HTTP/1.1\r\nHost: localhost\r\n" +
          "Content-Length: 10\r\nTransfer-Encoding: chunked\r\n\r\n",
      ),
    ];
    for (let sent = 0; sent < 2 * MiB; sent += chunk.length) {
      frames.push(Buffer.from(`${chunk.length.toString(16)}\r\n`), chunk);
      frames.push(Buffer.from("\r\n"));
    }
    frames.push(Buffer.from("0\r\n\r\n"));

    const reply = await new Promise<string>((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      let text = "";
      socket.on("data", (data: Buffer) => (text += data.toString("latin1")));
      socket.on("end", () => resolve(text));
      socket.on("error", () => resolve(text));
      socket.write(Buffer.concat(frames));
    });

    expect(reply.split("\r\n")[0]).toBe("HTTP/1.1 413 Payload Too Large");
    expect(seen).toHaveLength(1);
    await seen[0].closed;
    expect(seen[0].ended).toBe(false);
  });
});

describe("a declared Content-Length", () => {
  it("is left to the middleware, which refuses it with its own 413", async () => {
    // Node holds a body to its declared length exactly, so a declared body
    // can never outgrow what middleware already judged. The stand-in reads
    // the body first, as Next's middleware clone does, and only then answers.
    const port = await listen((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        const declared = Number(req.headers["content-length"]);
        res.writeHead(declared > MAX_REQUEST_BODY_BYTES ? 413 : 200, {
          "content-type": "application/json",
          "x-answered-by": "middleware",
        });
        res.end(JSON.stringify({ code: "PAYLOAD_TOO_LARGE" }));
      });
    });

    const answer = await send(port, "/api/v3/contact", randomBytes(2 * MiB), {
      declareLength: true,
    });

    expect(answer.status).toBe(413);
    expect(answer.headers["x-answered-by"]).toBe("middleware");
  });
});
