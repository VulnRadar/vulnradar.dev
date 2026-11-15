import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MOCK_KEY,
  SCENARIOS,
  createBody,
  startMockApi,
  statusBody,
} from "../fixtures/scan-gate/mock-api.mjs";
import { gateCounts, hasSummary } from "../../cli/lib.mjs";

/**
 * ci.yml's Scan gate action job runs the action against
 * tests/fixtures/scan-gate/mock-api.mjs on three operating systems, and the
 * repo tests run the action's script against the stand-in curl in
 * tests/fixtures/scan-gate/stand-in-curl.sh. Two fakes of one API drift
 * apart unless something holds them together: this boots the mock, makes
 * the round trips the action makes, and compares each reply with what the
 * stand-in answers for the same call, and with what the gate concludes from
 * it.
 */

const ROOT = path.resolve(__dirname, "../..");
const STAND_IN_CURL = readFileSync(
  path.join(ROOT, "tests/fixtures/scan-gate/stand-in-curl.sh"),
  "utf8",
);
const CLEAN = "https://clean.scan-gate.test/";
const FAILING = "https://failing.scan-gate.test/";

let server: Server;
let base = "";

beforeAll(async () => {
  server = await startMockApi();
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v3`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const auth = { authorization: `Bearer ${MOCK_KEY}` };

async function startScan(url: string, headers: Record<string, string> = auth) {
  const res = await fetch(`${base}/scan`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return { code: res.status, body: await res.text() };
}

async function poll(id: string) {
  const res = await fetch(`${base}/scan/status/${id}`, { headers: auth });
  return { code: res.status, body: await res.text() };
}

const shellAvailable = spawnSync("bash", ["--version"]).status === 0;

/** What the stand-in curl answers a call with these arguments. */
function standIn(args: string[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "scan-gate-mock-"));
  try {
    const file = path.join(dir, "call.sh").replace(/\\/g, "/");
    writeFileSync(
      file,
      [STAND_IN_CURL, `curl ${args.map((a) => `'${a}'`).join(" ")}`].join("\n"),
    );
    const r = spawnSync("bash", [file], {
      encoding: "utf8",
      env: { ...process.env, FAKE_STATUS_BODY: "", ...env },
    });
    // The Action's shape: the body, a newline, the code.
    const out = r.stdout;
    const cut = out.lastIndexOf("\n");
    return { code: Number(out.slice(cut + 1)), body: out.slice(0, cut) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the stand-in API", () => {
  it("refuses a request without the CI key", async () => {
    const r = await startScan(CLEAN, { authorization: "Bearer wrong" });
    expect(r.code).toBe(401);
    const none = await startScan(CLEAN, {});
    expect(none.code).toBe(401);
  });

  it("refuses a URL it has no scenario for, so a typo cannot pass as clean", async () => {
    const r = await startScan("https://other.scan-gate.test/");
    expect(r.code).toBe(400);
  });

  it("answers a clean round trip", async () => {
    const start = await startScan(CLEAN);
    expect(start.code).toBe(201);
    const { scanId } = JSON.parse(start.body);
    const status = await poll(scanId);
    expect(status.code).toBe(200);
    const body = JSON.parse(status.body);
    expect(body.status).toBe("completed");
    expect(hasSummary(body.result)).toBe(true);
    expect(gateCounts(body.result, { includeSuppressed: false })).toMatchObject(
      {
        critical: 0,
        high: 0,
        medium: 0,
        total: 0,
      },
    );
  });

  it("answers a failing round trip with 2 critical and 1 high", async () => {
    const start = await startScan(FAILING);
    expect(start.code).toBe(201);
    const { scanId } = JSON.parse(start.body);
    const status = await poll(scanId);
    const body = JSON.parse(status.body);
    expect(gateCounts(body.result, { includeSuppressed: false })).toMatchObject(
      {
        critical: 2,
        high: 1,
        medium: 0,
        total: 3,
      },
    );
  });

  it("serves the SARIF report the action downloads by default", async () => {
    const { scanId } = SCENARIOS[CLEAN];
    const res = await fetch(`${base}/history/${scanId}/report?format=sarif`, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).version).toBe("2.1.0");
  });

  it("answers an unknown scan id with 404", async () => {
    expect((await poll("nope")).code).toBe(404);
  });
});

describe.skipIf(!shellAvailable)(
  "the stand-in API and the stand-in curl agree",
  () => {
    it("on the scan start: the same code and, for the clean scan, the same body", async () => {
      const mock = await startScan(CLEAN);
      const fake = standIn(["-sS", "-X", "POST", `${base}/scan`]);
      expect(mock).toEqual(fake);
      expect(mock.body).toBe(createBody(SCENARIOS[CLEAN]));
    });

    it.each([CLEAN, FAILING])(
      "on the status poll of %s: the same code and the body the stand-in is given",
      async (url) => {
        const scenario = SCENARIOS[url as keyof typeof SCENARIOS];
        const mock = await poll(scenario.scanId);
        const fake = standIn(
          ["-sS", `${base}/scan/status/${scenario.scanId}`],
          {
            FAKE_STATUS_BODY: statusBody(scenario),
          },
        );
        expect(mock).toEqual(fake);
      },
    );
  },
);
