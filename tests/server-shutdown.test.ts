import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

/**
 * The whole point of owning shutdown: a deploy's SIGTERM used to close the
 * database pool while Next was still draining, so every in-flight request
 * failed on its next query and running scans were cut. This holds a request
 * open across the signal in a real process and reads the real exit code.
 */

const FIXTURE = path.resolve(__dirname, "fixtures", "held-request-server.mjs");

function startFixture() {
  const child = spawn(process.execPath, [FIXTURE], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const lines: string[] = [];
  const waiters = new Set<() => void>();
  let buffer = "";
  child.stdout!.on("data", (chunk) => {
    buffer += String(chunk);
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    lines.push(...parts);
    for (const wake of waiters) wake();
  });
  const waitFor = (match: RegExp) =>
    new Promise<string>((resolve) => {
      const check = () => {
        const found = lines.find((line) => match.test(line));
        if (found) {
          waiters.delete(check);
          resolve(found);
        }
      };
      waiters.add(check);
      check();
    });
  const exited = new Promise<number | null>((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  const terminate = () => {
    if (process.platform === "win32") child.send("SIGTERM");
    else child.kill("SIGTERM");
  };
  return { child, lines, waitFor, exited, terminate };
}

function get(port: number): Promise<{ status?: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, host: "127.0.0.1", agent: false }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

describe("graceful shutdown of the running server", () => {
  it("answers the held request, waits for the scan, then ends the pool and exits 0", async () => {
    const { lines, waitFor, exited, terminate } = startFixture();
    const port = Number((await waitFor(/^listening /)).split(" ")[1]);

    const held = get(port);
    await waitFor(/^held$/);
    terminate();

    const response = await held;
    expect(response).toEqual({ status: 200, body: "finished" });

    await expect(exited).resolves.toBe(0);
    expect(lines).toEqual([
      expect.stringMatching(/^listening /),
      "held",
      "workers-stopped",
      "responded",
      "scan-finished",
      "pool-ended",
    ]);
  }, 20_000);

  it("refuses a new connection once the signal has arrived", async () => {
    const { waitFor, exited, terminate } = startFixture();
    const port = Number((await waitFor(/^listening /)).split(" ")[1]);

    const held = get(port);
    await waitFor(/^held$/);
    terminate();
    await waitFor(/^workers-stopped$/);
    // close() runs right after the workers stop; give that tick a moment.
    await new Promise((done) => setTimeout(done, 100));

    await expect(get(port)).rejects.toThrow(/ECONNREFUSED|ECONNRESET/);

    await held;
    await expect(exited).resolves.toBe(0);
  }, 20_000);
});
