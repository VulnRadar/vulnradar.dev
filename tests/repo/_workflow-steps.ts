import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A reader for the workflow files the repo tests assert on.
 *
 * There is no YAML parser in the dependency tree and adding one to read a few
 * workflow files is not worth a new dependency, so this relies on the one
 * layout every workflow here shares: top-level keys at column 0, jobs at two
 * spaces, job keys at four, and every step a list item at exactly six. A step
 * runs from its `- ` line to the next step, or to the first line that is
 * neither indented past six nor blank, which is the next job.
 * tests/repo/workflow-hardening.test.ts fails on a file that leaves that
 * layout, so a workflow this reader would misread cannot pass unnoticed.
 */

const ROOT = path.resolve(__dirname, "../..");

export function readWorkflow(file: string): string {
  return readFileSync(
    path.join(ROOT, ".github", "workflows", file),
    "utf8",
  ).replace(/\r\n/g, "\n");
}

export interface WorkflowStep {
  /** The `name:` of the step, or null when it has none. */
  name: string | null;
  /** Position among the file's steps, in file order. */
  index: number;
  /** The step's lines, comments included. */
  raw: string;
  /** The step's lines with whole-line comments removed. */
  code: string;
}

function isStepStart(line: string): boolean {
  return /^ {6}- /.test(line);
}

function isCommentOrBlank(line: string): boolean {
  return line.trim() === "" || line.trim().startsWith("#");
}

export function workflowSteps(workflow: string): WorkflowStep[] {
  const lines = workflow.split("\n");
  const steps: WorkflowStep[] = [];
  let current: string[] | null = null;

  const close = () => {
    if (!current) return;
    // Whole-line comments between two steps sit at the step indent and belong
    // to the next one, so they are trimmed off the end of this one.
    while (
      current.length > 1 &&
      isCommentOrBlank(current[current.length - 1]) &&
      !/^ {8,}/.test(current[current.length - 1])
    ) {
      current.pop();
    }
    const raw = current.join("\n");
    const code = current.filter((l) => !l.trim().startsWith("#")).join("\n");
    const name = raw.match(/^ {6}- name:\s*(.+)$/m)?.[1]?.trim() ?? null;
    steps.push({ name, index: steps.length, raw, code });
    current = null;
  };

  for (const line of lines) {
    if (isStepStart(line)) {
      close();
      current = [line];
      continue;
    }
    if (!current) continue;
    const indent = line.length - line.trimStart().length;
    if (!isCommentOrBlank(line) && indent < 6) {
      close();
      continue;
    }
    current.push(line);
  }
  close();
  return steps;
}

export function stepNamed(steps: WorkflowStep[], name: string): WorkflowStep {
  const found = steps.find((s) => s.name === name);
  if (!found) throw new Error(`no step named "${name}"`);
  return found;
}

export interface WorkflowJob {
  /** The job's key under `jobs:`, which `needs:` refers to. */
  id: string;
  /** Its `name:`, the check name GitHub shows, or null when it has none. */
  name: string | null;
  /** The value of `timeout-minutes:`, or null. */
  timeoutMinutes: string | null;
  /**
   * What follows `permissions:` on its own line: "" for a block of scopes,
   * "{}" for the inline empty form, or null when the job declares none.
   */
  permissionsDeclared: string | null;
  /** The scopes of a block-form `permissions:`, empty for `{}` or none. */
  permissions: Record<string, string>;
  /** The value of `cache-mode:`, or null. */
  cacheMode: string | null;
  /** The job-level `if:`, folded onto one line, or null. */
  condition: string | null;
  /** The `strategy:` block's lines, or null. */
  strategy: string | null;
  /** The value of `needs:`, or null. */
  needs: string | null;
  steps: WorkflowStep[];
  /** The job's lines, comments included. */
  raw: string;
  /** The job's lines with whole-line comments removed. */
  code: string;
}

function isComment(line: string): boolean {
  return line.trim().startsWith("#");
}

/** The single-line value of a job-level key, with a trailing comment removed. */
function jobKey(lines: string[], key: string): string | null {
  const re = new RegExp(`^ {4}${key}:[ ]*(.*?)[ ]*(#.*)?$`);
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** The lines under a job-level block key, up to the next job-level key. */
function jobBlock(lines: string[], key: string): string[] | null {
  const at = lines.findIndex((l) => new RegExp(`^ {4}${key}:`).test(l));
  if (at === -1) return null;
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !isComment(line) && !/^ {5,}/.test(line)) break;
    body.push(line);
  }
  return body;
}

/** The job-level `if:` folded onto one line, as the runtime reads it. */
function jobIf(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const inline = /^ {4}if:\s*(.+)$/.exec(lines[i]);
    if (!inline) continue;
    if (!/^[>|]-?$/.test(inline[1].trim())) return inline[1].trim();
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "" && !/^ {6}/.test(lines[j])) break;
      body.push(lines[j].trim());
    }
    return body.join(" ").trim();
  }
  return null;
}

/**
 * Every job of a workflow, in file order. `jobs:` has to be the last
 * top-level key, which the hardening test asserts.
 */
export function jobsOf(workflow: string): WorkflowJob[] {
  const lines = workflow.split("\n");
  const start = lines.indexOf("jobs:");
  if (start === -1) throw new Error("the workflow has no jobs: block");
  const found: { id: string; lines: string[] }[] = [];
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) found.push({ id: header[1], lines: [] });
    else found[found.length - 1]?.lines.push(line);
  }
  return found.map(({ id, lines: jobLines }) => {
    const permissionsDeclared = jobKey(jobLines, "permissions");
    const permissions: Record<string, string> = {};
    if (permissionsDeclared === "") {
      for (const line of jobBlock(jobLines, "permissions") ?? []) {
        if (line.trim() === "" || isComment(line)) continue;
        const entry = /^ {6}([a-z-]+):\s*(\S+)\s*(#.*)?$/.exec(line);
        if (!entry) break;
        permissions[entry[1]] = entry[2];
      }
    }
    const strategy = jobBlock(jobLines, "strategy");
    const name = jobKey(jobLines, "name");
    return {
      id,
      name: name === null ? null : name.replace(/^(["'])(.*)\1$/, "$2"),
      timeoutMinutes: jobKey(jobLines, "timeout-minutes"),
      permissionsDeclared,
      permissions,
      cacheMode: jobKey(jobLines, "cache-mode"),
      condition: jobIf(jobLines),
      strategy: strategy === null ? null : strategy.join("\n"),
      needs: jobKey(jobLines, "needs"),
      steps: workflowSteps(jobLines.join("\n")),
      raw: jobLines.join("\n"),
      code: jobLines.filter((l) => !isComment(l)).join("\n"),
    };
  });
}

export function jobNamed(jobs: WorkflowJob[], id: string): WorkflowJob {
  const found = jobs.find((j) => j.id === id);
  if (!found) throw new Error(`no job with the id "${id}"`);
  return found;
}

/**
 * A top-level key: the value on its own line (a trailing comment removed),
 * and the indented lines under it. Null when the workflow has no such key.
 */
export function topLevel(
  workflow: string,
  key: string,
): { value: string; body: string } | null {
  const lines = workflow.split("\n");
  const re = new RegExp(`^${key}:[ ]*(.*?)[ ]*(#.*)?$`);
  const at = lines.findIndex((l) => re.test(l));
  if (at === -1) return null;
  const value = re.exec(lines[at])![1];
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !isComment(line) && !/^\s/.test(line)) break;
    body.push(line);
  }
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  return { value, body: body.join("\n") };
}
