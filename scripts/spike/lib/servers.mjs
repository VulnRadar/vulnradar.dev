import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { nextBin } from "./fixture.mjs";
import { rawRequest } from "./http.mjs";

const IS_WINDOWS = process.platform === "win32";
const LOG_LINES = 400;

function collectOutput(child) {
  const lines = [];
  const push = (chunk) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line) lines.push(line);
    }
    if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
  };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  return lines;
}

async function waitReady(port, isAlive, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error("server exited before it became ready");
    try {
      const res = await rawRequest({
        port,
        path: "/api/spike/ping",
        headers: { "x-forwarded-proto": "https" },
        timeoutMs: 20_000,
      });
      if (res.status === 200) return;
      lastError = `ping answered ${res.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  throw new Error(`server not ready on port ${port}: ${lastError}`);
}

/**
 * Spawn `next dev` or `next start` on the prepared fixture.
 *
 * `next start` is given the environment the image sets (PORT, HOSTNAME) and no
 * -H flag unless `bind` is passed, because that is how the image runs it:
 * `npm start` with HOSTNAME=0.0.0.0 in the environment. Whether Next reads
 * HOSTNAME at all is one of the things the run reveals; `bind` adds the -H
 * variant that a bare-metal or Pterodactyl install uses.
 */
export async function startNext({ mode, workdir, port, bind }) {
  const args = [nextBin(workdir), mode, "-p", String(port)];
  if (bind) args.push("-H", bind);

  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: mode === "dev" ? "development" : "production",
    PORT: String(port),
  };
  if (mode === "start") env.HOSTNAME = "0.0.0.0";

  const child = spawn(process.execPath, args, {
    cwd: workdir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !IS_WINDOWS,
  });
  const output = collectOutput(child);
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  try {
    await waitReady(port, () => !exited, mode === "dev" ? 240_000 : 90_000);
  } catch (error) {
    stopTree(child);
    throw new Error(`${error.message}\n${output.slice(-40).join("\n")}`);
  }

  return {
    output: () => output.slice(),
    stop: async () => {
      stopTree(child);
      await sleep(300);
    },
  };
}

function stopTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already gone between the exit check and the kill.
  }
}

export function runNextBuild({ workdir }) {
  const result = spawnSync(process.execPath, [nextBin(workdir), "build"], {
    cwd: workdir,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("next build failed");
}

function docker(args, options = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...options });
}

export function dockerAvailable() {
  const probe = docker(["version", "--format", "{{.Server.Version}}"]);
  return probe.status === 0;
}

/**
 * Build the fixture image and run it the way the production container runs:
 * its own CMD, a published port, no host networking. `--add-host` points a
 * made-up hostname at the host gateway so a rewrite that left the origin would
 * reach the recording listener running on the host.
 */
export async function startImage({ workdir, port, hostileName }) {
  const tag = "vulnradar-spike-fixture:ci";
  const name = `vr-spike-${process.pid}`;

  const build = docker(["build", "-t", tag, workdir], { stdio: "inherit" });
  if (build.status !== 0) throw new Error("docker build failed");

  docker(["rm", "-f", name]);
  const run = docker([
    "run",
    "-d",
    "--name",
    name,
    "--add-host",
    `${hostileName}:host-gateway`,
    "-p",
    `127.0.0.1:${port}:3000`,
    tag,
  ]);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);

  const alive = () =>
    docker(["inspect", "-f", "{{.State.Running}}", name]).stdout.trim() ===
    "true";
  try {
    await waitReady(port, alive, 120_000);
  } catch (error) {
    const logs = docker(["logs", "--tail", "60", name]);
    docker(["rm", "-f", name]);
    throw new Error(`${error.message}\n${logs.stdout}${logs.stderr}`);
  }

  return {
    output: () => {
      const logs = docker(["logs", "--tail", "200", name]);
      return `${logs.stdout}${logs.stderr}`.split(/\r?\n/).filter(Boolean);
    },
    readFile: (file) => {
      const out = docker(["exec", name, "cat", file]);
      return out.status === 0 ? out.stdout : null;
    },
    nodeVersion: () => docker(["exec", name, "node", "-v"]).stdout.trim(),
    stop: async () => {
      docker(["rm", "-f", name]);
    },
  };
}

export const MANIFEST_RELATIVE = path.join(
  ".next",
  "server",
  "functions-config-manifest.json",
);
