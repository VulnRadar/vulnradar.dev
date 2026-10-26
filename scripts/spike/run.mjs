#!/usr/bin/env node
/**
 * SPIKE harness for the Next.js routing claims the API v4 Move rests on
 * (spec 14.1). It builds the fixture app in tests/spike/fixture, serves it the
 * three ways the product runs (`next dev`, `next start`, the production image)
 * and runs the checks of SPIKE 1 to 6 against each, writing one JSON file per
 * target. scripts/spike/summarise.mjs turns those files into the pass or fail
 * table. SPIKE 7 is a pure node benchmark in scripts/spike/bench-serialise.mjs.
 *
 *   node scripts/spike/run.mjs --target start
 *   node scripts/spike/run.mjs --target all --install --require-docker
 *   node scripts/spike/run.mjs --mutate all --out spike-results/mutations
 *
 * Options
 *   --target     dev | start | start-h | image | all   (default all)
 *   --mutate     a mutation name from mutations.mjs, or all: break the scratch
 *                copy of the fixture on purpose and require the checks to
 *                notice. Proves the harness can fail. Replaces --target.
 *   --port       port to serve on, 3104 by default (3100 + the cluster index)
 *   --out        directory for the result files, ./spike-results by default
 *   --workdir    scratch directory for the copies and builds, in the OS temp
 *                directory by default (never inside the repository)
 *   --install    npm install the three pinned packages instead of linking the
 *                repository's node_modules (what CI does)
 *   --require-docker  fail instead of skipping the image when Docker is absent
 *
 * `start-h` is `next start -H 0.0.0.0`, the bare-metal and Pterodactyl shape.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { run as runSpike1 } from "./checks/spike1-headers.mjs";
import { run as runSpike2 } from "./checks/spike2-routing.mjs";
import { run as runSpike3 } from "./checks/spike3-bodies.mjs";
import { run as runSpike4 } from "./checks/spike4-response-headers.mjs";
import { run as runSpike5 } from "./checks/spike5-urls.mjs";
import { run as runSpike6 } from "./checks/spike6-maxduration.mjs";
import {
  installDependencies,
  installedNextVersion,
  pinnedVersions,
  prepareImageContext,
  prepareWorkdir,
  repositoryNodeModules,
} from "./lib/fixture.mjs";
import { rawRequest } from "./lib/http.mjs";
import { startRecorder } from "./lib/recorder.mjs";
import { createReport } from "./lib/report.mjs";
import {
  dockerAvailable,
  runNextBuild,
  startImage,
  startNext,
} from "./lib/servers.mjs";
import { MUTATIONS, applyMutation, spikesFor } from "./mutations.mjs";

const EVIL_NAME = "evil.example";
const IMAGE_PORT = 3000;

const CHECK_MODULES = [
  [1, runSpike1],
  [2, runSpike2],
  [3, runSpike3],
  [4, runSpike4],
  [5, runSpike5],
  [6, runSpike6],
];

const TARGETS = {
  dev: { name: "dev", mode: "dev", label: "next dev" },
  start: { name: "start", mode: "start", label: "next start" },
  "start-h": {
    name: "start-h",
    mode: "start",
    bind: "0.0.0.0",
    label: "next start -H 0.0.0.0",
  },
  image: { name: "image", mode: "image", label: "production image" },
};

const PROD_LIKE_HEADERS = {
  "x-forwarded-proto": "https",
  "accept-encoding": "identity",
};

function parse() {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: "all" },
      mutate: { type: "string" },
      port: { type: "string", default: "3104" },
      out: { type: "string", default: "spike-results" },
      workdir: { type: "string" },
      install: { type: "boolean", default: false },
      "require-docker": { type: "boolean", default: false },
    },
  });
  return {
    target: values.target,
    mutate: values.mutate,
    port: Number.parseInt(values.port, 10),
    out: path.resolve(values.out),
    workdir: path.resolve(
      values.workdir ?? path.join(os.tmpdir(), "vulnradar-spike"),
    ),
    install: values.install,
    requireDocker: values["require-docker"],
  };
}

/** Request helper: production-like proxy headers, a null header removes one. */
function makeRequester(port) {
  return (requestPath, options = {}) => {
    const headers = {};
    for (const [name, value] of Object.entries({
      ...PROD_LIKE_HEADERS,
      ...options.headers,
    })) {
      if (value !== null && value !== undefined) headers[name] = value;
    }
    return rawRequest({ port, path: requestPath, ...options, headers });
  };
}

let installedModules = null;

/** One npm install per run, shared by every target that is not the image. */
function modulesFor(opts) {
  if (!opts.install) return repositoryNodeModules();
  installedModules ??= installDependencies(path.join(opts.workdir, "_deps"));
  return installedModules;
}

async function runTarget(target, opts, mutation = null) {
  const workdir = path.join(opts.workdir, target.name);
  console.log(`\n=== ${target.label} (port ${opts.port}) ===`);

  const result = {
    target: { ...target },
    mutation: null,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    next: null,
    checks: [],
    facts: {},
    error: null,
  };
  const recorder = await startRecorder();
  let server = null;

  try {
    if (target.mode === "image") {
      prepareWorkdir({ workdir, nodeModulesFrom: null });
      prepareImageContext({ workdir });
      server = await startImage({
        workdir,
        port: opts.port,
        hostileName: EVIL_NAME,
      });
      result.node = `container ${server.nodeVersion()}`;
    } else {
      prepareWorkdir({ workdir, nodeModulesFrom: modulesFor(opts) });
      if (mutation) applyMutation(workdir, mutation);
      if (target.mode === "start") runNextBuild({ workdir });
      server = await startNext({
        mode: target.mode,
        workdir,
        port: opts.port,
        bind: target.bind,
      });
    }

    const wantedNext = pinnedVersions().next;
    result.next =
      target.mode === "image" ? wantedNext : installedNextVersion(workdir);
    if (result.next !== wantedNext) {
      throw new Error(
        `fixture runs Next ${result.next} but the app pins ${wantedNext}`,
      );
    }

    const ctx = {
      target: {
        ...target,
        internalPort: target.mode === "image" ? IMAGE_PORT : opts.port,
        hostnameEnv: target.mode === "start" ? "0.0.0.0" : undefined,
      },
      port: opts.port,
      req: makeRequester(opts.port),
      hostile: {
        recorder,
        evilName: EVIL_NAME,
        recorderHostHeader:
          target.mode === "image"
            ? `${EVIL_NAME}:${recorder.port}`
            : `127.0.0.1:${recorder.port}`,
      },
      facts: result.facts,
      shared: {},
      readBuildManifest: async () => {
        if (target.mode === "dev") return null;
        const raw =
          target.mode === "image"
            ? server.readFile(
                "/app/.next/server/functions-config-manifest.json",
              )
            : readFileSync(
                path.join(
                  workdir,
                  ".next/server/functions-config-manifest.json",
                ),
                "utf8",
              );
        return raw ? JSON.parse(raw) : null;
      },
    };

    await warmUp(ctx);

    const report = createReport();
    result.checks = report.checks;
    const wanted = mutation ? spikesFor(mutation) : null;
    for (const [spike, run] of CHECK_MODULES) {
      if (wanted && !wanted.includes(spike)) continue;
      await run(ctx, report);
    }
  } catch (error) {
    result.error = error.message;
    console.error(`  ERROR ${error.message}`);
    if (server) {
      console.error(server.output().slice(-30).join("\n"));
    }
  } finally {
    await recorder.close();
    if (server) await server.stop();
  }

  if (mutation) {
    const status = new Map(result.checks.map((c) => [c.id, c.status]));
    const missed = mutation.expectFail.filter(
      (id) => status.get(id) !== "fail",
    );
    result.mutation = {
      name: mutation.name,
      describes: mutation.describes,
      expectFail: mutation.expectFail,
      missed,
      detected: !result.error && missed.length === 0,
    };
    console.log(
      result.mutation.detected
        ? `  DETECTED ${mutation.name}: ${mutation.expectFail.join(", ")} failed as they must`
        : `  MISSED ${mutation.name}: ${missed.join(", ") || "run error"} did not fail`,
    );
  }

  mkdirSync(opts.out, { recursive: true });
  writeFileSync(
    path.join(opts.out, `${target.name}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}

/**
 * Touch every route once so `next dev` has compiled it before any timing is
 * taken. The responses are discarded.
 */
async function warmUp(ctx) {
  const paths = [
    ["GET", "/api/v3/history/abc/report"],
    ["GET", "/api/v4/history/abc/report"],
    ["POST", "/api/v3/history/abc"],
    ["POST", "/api/v4/history/abc"],
    ["POST", "/api/v3/scan/verify"],
    ["GET", "/api/v3/echo"],
    ["GET", "/api/internal/echo"],
    ["GET", "/api/v3/static-sibling"],
    ["GET", "/api/v3/badge/scans"],
    ["GET", "/api/v3/badge/x"],
    ["GET", "/api/v3/nothing/here"],
    ["POST", "/api/v3/ai/chat"],
    ["POST", "/api/internal/ai/chat"],
    ["GET", "/api/v3/admin/audit-log/export"],
    ["GET", "/api/internal/admin/audit-log/export"],
    ["GET", "/security.txt"],
    ["GET", "/api/spike-control/target"],
  ];
  for (const [method, p] of paths) {
    try {
      await ctx.req(p, {
        method,
        headers:
          method === "POST" ? { "content-type": "application/json" } : {},
        body: method === "POST" ? "{}" : undefined,
        timeoutMs: 120_000,
      });
    } catch {
      // A warm-up miss shows up as a failed check later, with a message.
    }
  }
}

async function runMutations(opts) {
  const names = opts.mutate === "all" ? Object.keys(MUTATIONS) : [opts.mutate];
  const missed = [];
  for (const name of names) {
    if (!MUTATIONS[name]) throw new Error(`unknown mutation ${name}`);
    const mutation = { name, ...MUTATIONS[name] };
    const base = TARGETS[mutation.target ?? "dev"];
    const target = {
      ...base,
      name: `mutation-${name}`,
      label: `mutation ${name} on ${base.label}`,
    };
    const result = await runTarget(target, opts, mutation);
    if (!result.mutation?.detected) missed.push(name);
    await sleep(1500);
  }
  if (missed.length) {
    console.error(
      `\nMutations the checks did not notice: ${missed.join(", ")}`,
    );
    process.exitCode = 1;
  }
}

async function main() {
  const opts = parse();
  if (opts.mutate) {
    await runMutations(opts);
    return;
  }
  const names =
    opts.target === "all"
      ? ["dev", "start", "start-h", "image"]
      : [opts.target];
  for (const name of names) {
    if (!TARGETS[name]) throw new Error(`unknown target ${name}`);
  }

  const failures = [];
  for (const name of names) {
    const target = TARGETS[name];
    if (target.mode === "image" && !dockerAvailable()) {
      const message = "Docker is not available on this machine";
      if (opts.target === "image" || opts.requireDocker) {
        throw new Error(message);
      }
      console.log(`\n=== ${target.label} skipped: ${message} ===`);
      mkdirSync(opts.out, { recursive: true });
      writeFileSync(
        path.join(opts.out, "image.json"),
        `${JSON.stringify({ target, checks: [], facts: {}, skipped: message }, null, 2)}\n`,
      );
      continue;
    }
    const result = await runTarget(target, opts);
    if (result.error || result.checks.some((c) => c.status === "fail")) {
      failures.push(target.label);
    }
    await sleep(1500);
  }

  if (failures.length) {
    console.error(`\nFailed targets: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
