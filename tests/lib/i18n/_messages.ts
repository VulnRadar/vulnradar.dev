/**
 * Reading the translation files for the suites in this folder.
 *
 * From disk rather than through lib/i18n/messages/catalog.ts, so a file the
 * catalog forgot to import is something these tests can see.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type Tree = { [key: string]: string | Tree };

export const MESSAGES_DIR = path.resolve(
  __dirname,
  "../../../lib/i18n/messages",
);

/** The namespaces a language has files for, sorted. */
export function namespacesOf(locale: string): string[] {
  return readdirSync(path.join(MESSAGES_DIR, locale))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
}

/** One language as the tree next-intl is given: namespace -> keys. */
export function loadLocale(locale: string): Tree {
  const tree: Tree = {};
  for (const namespace of namespacesOf(locale)) {
    tree[namespace] = JSON.parse(
      readFileSync(
        path.join(MESSAGES_DIR, locale, `${namespace}.json`),
        "utf8",
      ),
    ) as Tree;
  }
  return tree;
}

/** Every key as a dotted path, with its string value. */
export function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(keyPath, value);
    else for (const [k, v] of flatten(value, keyPath)) out.set(k, v);
  }
  return out;
}
