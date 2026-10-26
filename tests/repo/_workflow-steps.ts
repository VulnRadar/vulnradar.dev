import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A reader for the two workflow files the repo tests assert on.
 *
 * There is no YAML parser in the dependency tree and adding one to read two
 * files is not worth a new dependency, so this relies on the one layout both
 * files share: jobs at two spaces, `steps:` at four, and every step a list
 * item at exactly six. A step runs from its `- ` line to the next step, or to
 * the first line that is neither indented past six nor blank, which is the next
 * job.
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
