/**
 * Every email and name field in the auth and contact forms says what it holds
 * (WCAG 1.3.5, Identify Input Purpose), so a browser or an assistive tool can
 * fill in the visitor's own details.
 *
 * The contact form's name and email had no autocomplete at all. A source scan
 * rather than a render, so a field added to any of these forms later is held
 * to the same rule without anyone writing a test for it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["components/auth", "components/contact"];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Each `<Input ...>` or `<input ...>` opening tag, with its line number. */
function inputTags(source: string): Array<{ tag: string; line: number }> {
  const tags: Array<{ tag: string; line: number }> = [];
  const re = /<(?:Input|input)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    // The tag ends at the first ">" that is not part of "=>" in a handler.
    let i = match.index;
    let depth = 0;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push({
      tag: source.slice(match.index, i + 1),
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return tags;
}

const files = ROOTS.flatMap((root) => tsxFiles(path.join(process.cwd(), root)));

describe("autocomplete on identity fields in components/auth and components/contact", () => {
  it("finds the forms it is meant to cover", () => {
    const names = files.map((f) => path.basename(f));
    expect(names).toContain("contact-form.tsx");
    expect(names).toContain("signup-form.tsx");
  });

  it("gives every email field an autocomplete token", () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const { tag, line } of inputTags(readFileSync(file, "utf8"))) {
        if (/type="email"/.test(tag) && !/autoComplete=/.test(tag)) {
          missing.push(`${path.relative(process.cwd(), file)}:${line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives every name field autoComplete="name"', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const { tag, line } of inputTags(readFileSync(file, "utf8"))) {
        if (/\bid="(?:[\w-]+-)?name"/.test(tag)) {
          if (!/autoComplete="name"/.test(tag)) {
            missing.push(`${path.relative(process.cwd(), file)}:${line}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
