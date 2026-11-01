/**
 * readPage against a real socket that never stops sending.
 *
 * page-fetch.test.ts covers what readPage decides with a mocked safeFetch.
 * This file covers what it costs: a local server writes 64 KiB chunks for as
 * long as the client keeps reading, and readPage has to stop at its cap and
 * hang up instead of buffering the stream until its 8 s deadline. safeFetch is
 * replaced by plain fetch only because the real one refuses loopback, which
 * is the address this server listens on; the body handling under test is
 * readPage's own.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: vi.fn((url: string, init?: RequestInit) => fetch(url, init)),
}));

import { readPage } from "@/lib/scanner/page-fetch";

const CHUNK = Buffer.alloc(64 * 1024, 0x61);
// The cap readPage applies, in bytes.
const CAP = 1_000_000;

let server: Server;
let baseUrl: string;
let bytesSent = 0;
let clientHungUp = false;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    let open = true;
    res.on("close", () => {
      open = false;
      clientHungUp = true;
    });
    // Honour backpressure so the server's own buffers stay small and what
    // the memory reading below sees is the client side.
    const pump = () => {
      while (open) {
        bytesSent += CHUNK.length;
        if (!res.write(CHUNK)) {
          res.once("drain", pump);
          return;
        }
      }
    };
    pump();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("readPage on an endless body", () => {
  it("stops at its cap, hangs up, and keeps memory flat", async () => {
    const before = process.memoryUsage().arrayBuffers;
    const started = Date.now();

    const page = await readPage(baseUrl);
    const elapsed = Date.now() - started;

    // A buffered read only ends at the 8 s fetch deadline, and then as a
    // failure (null) after holding every byte received until then.
    expect(page).not.toBeNull();
    expect(page?.status).toBe(200);
    expect(page?.body.length).toBe(CAP);
    expect(page?.truncated).toBe(true);
    expect(elapsed).toBeLessThan(4000);

    const grown = process.memoryUsage().arrayBuffers - before;
    expect(grown).toBeLessThan(4 * 1024 * 1024);

    // The connection is released, so the server stops writing.
    await vi.waitFor(() => expect(clientHungUp).toBe(true), {
      timeout: 2000,
    });
    const sentAtHangUp = bytesSent;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bytesSent).toBe(sentAtHangUp);
  }, 15_000);
});
