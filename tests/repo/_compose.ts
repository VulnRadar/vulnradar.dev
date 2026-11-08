import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A reader for the compose files the repo tests assert on. There is no YAML
 * parser in the dependency tree (see _workflow-steps.ts), so this reads the one
 * layout the files share: a mapping's entries sit two spaces deeper than the
 * key that owns them, and a block ends at the first line that is not deeper.
 */

const ROOT = path.resolve(__dirname, "../..");

export const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.dev.yml"];

export function readCompose(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}

export interface ComposeEntry {
  key: string;
  value: string;
}

/** The direct children of every `<name>:` block in `yaml`, block by block. */
export function blocksNamed(yaml: string, name: string): ComposeEntry[][] {
  const lines = yaml.split("\n");
  const blocks: ComposeEntry[][] = [];
  const opener = new RegExp(`^( *)${name}:\\s*(#.*)?$`);
  lines.forEach((line, index) => {
    const match = opener.exec(line);
    if (!match) return;
    const indent = match[1].length;
    const entries: ComposeEntry[] = [];
    for (let i = index + 1; i < lines.length; i++) {
      const current = lines[i];
      if (current.trim() === "" || current.trim().startsWith("#")) continue;
      const depth = current.length - current.trimStart().length;
      if (depth <= indent) break;
      if (depth !== indent + 2) continue;
      const entry = /^\s*(?:- )?([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/.exec(
        current,
      );
      if (entry) entries.push({ key: entry[1], value: entry[2].trim() });
    }
    blocks.push(entries);
  });
  return blocks;
}

/** Entries that would turn "not set" into "set to the empty string". */
export function emptyStringDefaults(yaml: string): string[] {
  return blocksNamed(yaml, "environment").flatMap((entries) =>
    entries
      .filter(({ value }) => /\$\{[A-Za-z_][A-Za-z0-9_]*:?-\}/.test(value))
      .map(({ key }) => key),
  );
}
