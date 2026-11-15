#!/usr/bin/env node
// Prints the shell script a composite action runs, so shellcheck can read it.
//
//   node scripts/ci/extract-action-script.mjs .github/actions/scan-gate/action.yml > scan-gate.sh
//
// actionlint lints workflows and checks the shell in their `run:` blocks, but
// it does not read a composite action, and the scan-gate action is the one
// script here that users run in their own pipelines with their own API key.
// This takes the `run:` block of the step with `id: scan`, dedented, which is
// what bash receives once the runner has set the env: values.
//
// No YAML parser: the action's steps are `- ` items under `runs.steps`, and
// the script is a literal block scalar (`run: |`), the one shape this reads.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The dedented body of the `run: |` block of the step whose `id` is `stepId`,
 * with a trailing newline. Throws when there is no such step or block.
 */
export function extractRunBody(yaml, stepId = "scan") {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");

  const idAt = lines.findIndex((l) =>
    new RegExp(`^\\s*(?:- )?id:\\s*${stepId}\\s*$`).test(l),
  );
  if (idAt === -1) throw new Error(`no step with id: ${stepId}`);

  // The step's `- ` line is the nearest one above that is a list item.
  let start = idAt;
  while (start > 0 && !/^\s*- /.test(lines[start])) start--;
  const stepIndent = indentOf(lines[start]);

  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].trim() === "" || indentOf(lines[end]) > stepIndent)
  ) {
    end++;
  }

  const opener = lines
    .slice(start, end)
    .findIndex((l) => /^\s*(?:- )?run:\s*[|][-+]?\s*$/.test(l));
  if (opener === -1) {
    throw new Error(`step ${stepId} has no run: | block`);
  }
  const first = start + opener + 1;
  const indent = indentOf(lines[first]);
  if (indent <= indentOf(lines[start + opener])) {
    throw new Error(`step ${stepId}'s run: block is empty`);
  }

  const body = [];
  for (const line of lines.slice(first, end)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (indentOf(line) < indent) break;
    body.push(line.slice(indent));
  }
  while (body.length > 0 && body[body.length - 1] === "") body.pop();
  return `${body.join("\n")}\n`;
}

function main(argv) {
  const [file] = argv;
  if (!file) {
    console.error("usage: extract-action-script.mjs <action.yml>");
    return 2;
  }
  process.stdout.write(extractRunBody(readFileSync(file, "utf8")));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
