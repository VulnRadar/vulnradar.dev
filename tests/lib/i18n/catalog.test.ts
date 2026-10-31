/**
 * The static import list for the message files
 * (lib/i18n/messages/catalog.ts, written by lib/i18n/build-catalog.mjs).
 *
 * The files are split by language and namespace so that the people translating
 * one surface touch that surface's files and nobody else's. The price is a
 * list of imports that has to name every one of them, because the imports must
 * be static. These tests are what makes that list safe to depend on: a
 * namespace added on disk and not to the list would otherwise be a surface
 * that falls back to English in every language, with nothing failing.
 */
import { afterAll, describe, it, expect } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { CATALOG } from "@/lib/i18n/messages/catalog";
import {
  CATALOG_FILE,
  renderCatalog,
  scanMessages,
} from "@/lib/i18n/build-catalog.mjs";
import { flatten, loadLocale, namespacesOf } from "./_messages";

describe("the generated catalog", () => {
  it("is what the generator writes for the files on disk", () => {
    // CRLF-normalised: a Windows checkout may rewrite the line endings.
    const committed = readFileSync(CATALOG_FILE, "utf8").replace(/\r\n/g, "\n");
    expect(committed, "run: node lib/i18n/build-catalog.mjs").toBe(
      renderCatalog(),
    );
  });

  it("has a folder for every language the app speaks and no other", () => {
    expect(Object.keys(scanMessages()).sort()).toEqual([...LOCALES].sort());
  });

  it.each(LOCALES)("%s imports every namespace file it has", (locale) => {
    expect(Object.keys(CATALOG[locale]).sort()).toEqual(namespacesOf(locale));
  });

  it.each(LOCALES)("%s holds exactly what its files hold", (locale) => {
    expect(CATALOG[locale]).toEqual(loadLocale(locale));
  });
});

describe("getMessages", () => {
  it("serves English as the catalog has it", async () => {
    expect(await getMessages(DEFAULT_LOCALE)).toBe(CATALOG[DEFAULT_LOCALE]);
  });

  it.each(LOCALES)("%s resolves every English key", async (locale) => {
    const english = [...flatten(loadLocale(DEFAULT_LOCALE)).keys()];
    const served = flatten(
      (await getMessages(locale)) as unknown as Parameters<typeof flatten>[0],
    );
    expect(english.filter((key) => !served.has(key))).toEqual([]);
  });

  it("puts a translation over English, key by key", async () => {
    const ja = flatten(
      (await getMessages("ja")) as unknown as Parameters<typeof flatten>[0],
    );
    expect(ja.get("nav.logOut")).toBe(
      flatten(loadLocale("ja")).get("nav.logOut"),
    );
    expect(ja.get("nav.logOut")).not.toBe(
      flatten(loadLocale("en")).get("nav.logOut"),
    );
  });
});

describe("the generator refuses a layout it cannot import", () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  function messagesDir(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "vr-i18n-"));
    made.push(dir);
    for (const [relative, body] of Object.entries(files)) {
      const target = path.join(dir, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
    return dir;
  }

  it("lists the files of a well-formed folder", () => {
    const dir = messagesDir({
      "en/nav.json": "{}",
      "pt-BR/nav.json": "{}",
      "pt-BR/aiChat.json": "{}",
    });
    expect(scanMessages(dir)).toEqual({
      en: ["nav"],
      "pt-BR": ["aiChat", "nav"],
    });
    expect(renderCatalog(dir)).toContain('"pt-BR": {');
    expect(renderCatalog(dir)).toContain("aiChat: ptBRAiChat,");
  });

  it("rejects a folder that is not a locale", () => {
    const dir = messagesDir({ "english/nav.json": "{}" });
    expect(() => scanMessages(dir)).toThrow(/not a locale folder/);
  });

  it("rejects a namespace file that is not a plain camelCase name", () => {
    const dir = messagesDir({ "en/ai-chat.json": "{}" });
    expect(() => scanMessages(dir)).toThrow(/camelCase/);
  });
});
