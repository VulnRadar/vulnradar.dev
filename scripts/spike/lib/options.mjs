import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { unlinkIfLink } from "./fixture.mjs";

/**
 * The command-line options of scripts/spike/run.mjs.
 *
 * Without --workdir the scratch directory comes from mkdtemp: a fixed name in
 * the OS temp directory could be created first, or made a symlink, by another
 * account on a shared machine, and the harness would then copy, build and
 * serve inside a tree somebody else controls. `ownsWorkdir` says the run made
 * the directory and should remove it when it is done.
 */
export function parseRunArgs(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
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
  const ownsWorkdir = values.workdir === undefined;
  return {
    target: values.target,
    mutate: values.mutate,
    port: Number.parseInt(values.port, 10),
    out: path.resolve(values.out),
    workdir: ownsWorkdir
      ? mkdtempSync(path.join(os.tmpdir(), "vulnradar-spike-"))
      : path.resolve(values.workdir),
    ownsWorkdir,
    install: values.install,
    requireDocker: values["require-docker"],
  };
}

/**
 * Delete a scratch root made by parseRunArgs. Each target directory in it may
 * hold a node_modules link to the repository's own node_modules, so those are
 * unlinked first and the recursive delete never reaches through one.
 */
export function removeScratchRoot(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      unlinkIfLink(path.join(root, entry.name, "node_modules"));
    }
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
