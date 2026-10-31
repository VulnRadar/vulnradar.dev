/**
 * Which keys each language has, and which of them anything uses.
 *
 * Every language has exactly English's keys: a missing one is a sentence that
 * silently reads in English inside a Japanese page (lib/i18n/messages.ts falls
 * back on purpose, so nothing else notices), and an extra one is a typo or a
 * key English lost that nobody read. The translation files are split per
 * namespace, so a change adds its keys to all six languages in the same commit.
 *
 * The second half is a report and not a gate. English keys that no source file
 * refers to are listed, never deleted and never a failure: a key added a
 * commit before the component that reads it is normal work, and a failing test
 * for it would only teach people to add the reference first and the words
 * never. The list errs toward "used": it reads source text, not types, so a
 * file that opens a namespace and happens to contain the same word as a key
 * (a status of "clean") hides that key from it.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { flatten, loadLocale, namespacesOf } from "./_messages";

const english = flatten(loadLocale(DEFAULT_LOCALE));
const translations = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

describe("every language has exactly the English keys", () => {
  it.each(translations)(
    "%s has a file for each English namespace",
    (locale) => {
      expect(namespacesOf(locale)).toEqual(namespacesOf(DEFAULT_LOCALE));
    },
  );

  it.each(translations)("%s is missing no key", (locale) => {
    const own = flatten(loadLocale(locale));
    expect(
      [...english.keys()].filter((key) => !own.has(key)),
      `${locale} has no translation for these (add them to its namespace files)`,
    ).toEqual([]);
  });

  it.each(translations)("%s has no key English lacks", (locale) => {
    const own = flatten(loadLocale(locale));
    expect(
      [...own.keys()].filter((key) => !english.has(key)),
      `${locale} has these and English does not (a typo, or English dropped them)`,
    ).toEqual([]);
  });
});

describe("plurals follow the ICU convention", () => {
  const PLURAL = /\{\s*([A-Za-z0-9_]+)\s*,\s*(?:plural|selectordinal)\s*,/g;

  /** The arguments a message pluralises on. */
  function pluralArguments(value: string): string[] {
    return [...value.matchAll(PLURAL)].map((match) => match[1]).sort();
  }

  it("has an `other` branch wherever English pluralises", () => {
    const without = [...english]
      .filter(([, value]) => pluralArguments(value).length > 0)
      .filter(([, value]) => !/\bother\s*\{/.test(value))
      .map(([key]) => key);
    // `other` is the one branch ICU requires: without it the message throws
    // for any count the other branches do not name.
    expect(without).toEqual([]);
  });

  it.each(translations)("%s pluralises on the same argument", (locale) => {
    const own = flatten(loadLocale(locale));
    const wrong: string[] = [];
    for (const [key, value] of english) {
      const expected = pluralArguments(value);
      if (expected.length === 0) continue;
      const actual = pluralArguments(own.get(key) ?? "");
      if (actual.join() !== expected.join()) {
        wrong.push(
          `${key}: plural on {${actual.join(", ")}}, English on {${expected.join(", ")}}`,
        );
      }
      if (!/\bother\s*\{/.test(own.get(key) ?? "")) {
        wrong.push(`${key}: no \`other\` branch`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// ─── Which English keys does any source file use? ───────────────────────────

const ROOT = path.resolve(__dirname, "../../..");
const SOURCE_DIRS = ["app", "components", "hooks", "lib"];
const SKIPPED_DIRS = new Set(["node_modules", ".next"]);
const MESSAGES_PATH = path.join("lib", "i18n", "messages");

interface Source {
  dir: string;
  /** A .ts module (a key table, a helper) rather than a component. */
  isModule: boolean;
  /** Identifier-shaped string literals: "scanner", "nav.scanner". */
  literals: Set<string>;
  /** The static start of a template literal such as `severity${level}`. */
  prefixes: Set<string>;
  /** Namespaces this file opens with useTranslations("nav") and the like. */
  namespaces: Set<string>;
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (full.includes(MESSAGES_PATH)) continue;
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.(?:tsx?|mjs|jsx?)$/.test(entry.name)) found.push(full);
  }
  return found;
}

const LITERAL = /["'`]([A-Za-z][\w.]*)["'`]/g;
const TEMPLATE_PREFIX = /`([A-Za-z][\w.]*)\$\{/g;
const NAMESPACE_CALL =
  /(?:useTranslations|getTranslations|getTranslator|createTranslator)\(\s*(?:\{[^)]*?namespace:\s*)?["'`]([A-Za-z][\w.]*)["'`]|namespace:\s*["'`]([A-Za-z][\w.]*)["'`]/g;

function readSource(file: string): Source {
  const text = readFileSync(file, "utf8");
  return {
    dir: path.dirname(file),
    isModule: file.endsWith(".ts") || file.endsWith(".mjs"),
    literals: new Set([...text.matchAll(LITERAL)].map((m) => m[1])),
    prefixes: new Set([...text.matchAll(TEMPLATE_PREFIX)].map((m) => m[1])),
    namespaces: new Set(
      [...text.matchAll(NAMESPACE_CALL)].map((m) => m[1] ?? m[2]),
    ),
  };
}

/**
 * Whether a source file refers to the key `namespace.inner`.
 *
 * Either it writes the whole path (`t("nav.scanner")`), or it writes the part
 * after the namespace ("scanner") in a file that opens that namespace. A plain
 * module beside a file that opens it counts as well: a key table such as
 * app/dashboard/scan-announcement.ts holds the `announce*` names, and
 * app/dashboard/page.tsx is what translates them. A component does not borrow
 * its neighbour's namespace, since a word like "clean" turns up in half of them.
 * A name built as a template literal (`severity${level}`) matches by its static
 * start.
 */
function makeIsReferenced(sources: Source[]) {
  const openedIn = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const namespace of source.namespaces) {
      let dirs = openedIn.get(namespace);
      if (!dirs) openedIn.set(namespace, (dirs = new Set()));
      dirs.add(source.dir);
    }
  }

  return (namespace: string, inner: string): boolean => {
    const dirs = openedIn.get(namespace);
    return sources.some((source) => {
      if (source.literals.has(`${namespace}.${inner}`)) return true;
      const opens =
        source.namespaces.has(namespace) ||
        (source.isModule && dirs?.has(source.dir) === true);
      return (
        opens &&
        (source.literals.has(inner) ||
          [...source.prefixes].some((prefix) => inner.startsWith(prefix)))
      );
    });
  };
}

describe("English keys that nothing references", () => {
  const sources = SOURCE_DIRS.flatMap((dir) =>
    sourceFiles(path.join(ROOT, dir)),
  ).map(readSource);
  const isReferenced = makeIsReferenced(sources);

  it("finds the keys the app does use, and not one it does not", () => {
    // Guards the report below: a scanner that matched nothing (a moved folder,
    // a changed call shape) would list every key and look like a finding.
    expect(isReferenced("nav", "scanner")).toBe(true);
    expect(isReferenced("scan", "heading")).toBe(true);
    expect(isReferenced("footer", "tagline")).toBe(true);
    expect(isReferenced("dashboard", "announceComplete")).toBe(true);
    expect(isReferenced("result", "severityHigh")).toBe(true);
    expect(isReferenced("nav", "noSuchKeyAnywhere")).toBe(false);
    expect(isReferenced("noSuchNamespace", "scanner")).toBe(false);
  });

  it("lists them (informational: it never fails on one)", () => {
    const unreferenced = [...english.keys()].filter((key) => {
      const [namespace, ...rest] = key.split(".");
      return !isReferenced(namespace, rest.join("."));
    });

    if (unreferenced.length > 0) {
      const byNamespace = new Map<string, string[]>();
      for (const key of unreferenced) {
        const [namespace, ...rest] = key.split(".");
        byNamespace.set(namespace, [
          ...(byNamespace.get(namespace) ?? []),
          rest.join("."),
        ]);
      }
      const lines = [...byNamespace].map(
        ([namespace, keys]) => `  ${namespace}: ${keys.join(", ")}`,
      );
      console.info(
        `${unreferenced.length} of ${english.size} English keys are not referenced by any file in ${SOURCE_DIRS.join(", ")}:\n${lines.join("\n")}`,
      );
    }

    // The one thing worth failing on: a list that is every key means the
    // scanner matched nothing, which is a broken report and not a finding.
    expect(unreferenced.length).toBeLessThan(english.size);
  });
});
