// A stand-in for the three VulnRadar API endpoints the scan-gate action
// calls, so CI can run the action itself (`uses: ./.github/actions/scan-gate`)
// without reaching anything off the runner. node:http only.
//
//   node tests/fixtures/scan-gate/mock-api.mjs --port-file <path>
//
// It listens on 127.0.0.1 on a free port, writes the port to --port-file once
// it is listening, and answers with the shapes the action reads, which are the
// replies tests/fixtures/scan-gate/stand-in-curl.sh gives:
// tests/repo/scan-gate-mock.test.ts holds the two to each other.
//
// The scenario is chosen by the URL the scan is started for. The .test names
// are data: nothing resolves them, and nothing here fetches them.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The key the CI job passes. Not a key: it only has to be the same string. */
export const MOCK_KEY = "vr-ci-not-a-key";

const finding = (id, severity) => ({
  id,
  title: `${severity} finding ${id}`,
  severity,
  suppressed: false,
});

export const SCENARIOS = {
  "https://clean.scan-gate.test/": {
    // The id stand-in-curl.sh answers a scan start with.
    scanId: "abc123",
    result: {
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
      findings: [],
      incomplete: [],
    },
  },
  "https://failing.scan-gate.test/": {
    scanId: "def456",
    result: {
      summary: { critical: 2, high: 1, medium: 0, low: 0, info: 0, total: 3 },
      findings: [
        finding("critical-one--1a2b3c", "critical"),
        finding("critical-two--4d5e6f", "critical"),
        finding("high-one--7a8b9c", "high"),
      ],
      incomplete: [],
    },
  },
};

/** The body of GET /scan/status/{id} for a scenario. */
export function statusBody(scenario) {
  return JSON.stringify({ status: "completed", result: scenario.result });
}

/** The body of POST /scan for a scenario. */
export function createBody(scenario) {
  return JSON.stringify({ scanId: scenario.scanId });
}

const SARIF = JSON.stringify({
  version: "2.1.0",
  runs: [{ tool: { driver: { name: "VulnRadar" } }, results: [] }],
});

// One request per connection: a kept-alive connection the server times out
// while a client is about to reuse it is reset, and a reset is a failed poll.
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type, connection: "close" });
  res.end(body);
}

/** Starts the server; resolves to it once it is listening. */
export function startMockApi({ port = 0 } = {}) {
  const byId = new Map(
    Object.values(SCENARIOS).map((scenario) => [scenario.scanId, scenario]),
  );
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${MOCK_KEY}`) {
      send(res, 401, JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const { pathname, searchParams } = new URL(req.url ?? "/", "http://mock");
    if (req.method === "POST" && pathname === "/api/v3/scan") {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        let url = "";
        try {
          url = JSON.parse(raw).url;
        } catch {
          send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
          return;
        }
        const scenario = SCENARIOS[url];
        if (!scenario) {
          send(res, 400, JSON.stringify({ error: "No scenario for this URL" }));
          return;
        }
        send(res, 201, createBody(scenario));
      });
      return;
    }
    const status = /^\/api\/v3\/scan\/status\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (req.method === "GET" && status) {
      const scenario = byId.get(status[1]);
      if (!scenario) send(res, 404, JSON.stringify({ error: "Not found" }));
      else send(res, 200, statusBody(scenario));
      return;
    }
    const report = /^\/api\/v3\/history\/([A-Za-z0-9_-]+)\/report$/.exec(
      pathname,
    );
    if (
      req.method === "GET" &&
      report &&
      byId.has(report[1]) &&
      searchParams.get("format") === "sarif"
    ) {
      send(res, 200, SARIF, "application/sarif+json");
      return;
    }
    send(res, 404, JSON.stringify({ error: "Not found" }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const at = process.argv.indexOf("--port-file");
  const portFile = at === -1 ? "" : process.argv[at + 1];
  if (!portFile) {
    console.error("usage: mock-api.mjs --port-file <path>");
    process.exit(2);
  }
  const server = await startMockApi();
  writeFileSync(portFile, String(server.address().port));
}
