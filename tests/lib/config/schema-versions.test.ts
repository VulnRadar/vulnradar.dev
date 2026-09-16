import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_KNOWN_SCHEMA_VERSIONS,
  CONFIG_MIN_SCHEMA_VERSION,
} from "@/lib/config/config-values";
import { VERSIONS } from "../../../scripts/migrate/_registry.mjs";

/**
 * The list of schema versions is written down three times: the app's
 * CONFIG_KNOWN_SCHEMA_VERSIONS (what the boot check recognises), the migration
 * registry's VERSIONS (what `npm run db:migrate` can detect and move between),
 * and create-fresh-db's SCHEMA_SOURCES (what a fresh database can be built
 * at). A schema version added to one and not the others is a database the app
 * refuses, the migrator cannot reach, or the installer cannot create.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");
const registryNames = (VERSIONS as { name: string }[]).map((v) => v.name);

describe("schema versions are the same list everywhere", () => {
  it("the migration registry knows exactly the versions the app knows", () => {
    expect(registryNames).toEqual(CONFIG_KNOWN_SCHEMA_VERSIONS);
  });

  it("create-fresh-db can build exactly those versions", () => {
    const source = readFileSync(
      path.join(ROOT, "scripts/create-fresh-db/create-fresh-db.mjs"),
      "utf8",
    );
    const block = /const SCHEMA_SOURCES = \{([\s\S]*?)\n\};/.exec(source)?.[1];
    expect(block, "SCHEMA_SOURCES not found").toBeTruthy();
    const keys = [...block!.matchAll(/^\s*"(\d+\.\d+\.\d+)":/gm)].map(
      (m) => m[1],
    );
    expect(keys).toEqual(CONFIG_KNOWN_SCHEMA_VERSIONS);
  });

  it("the minimum the app requires is the newest schema that exists", () => {
    expect(CONFIG_MIN_SCHEMA_VERSION).toBe(
      CONFIG_KNOWN_SCHEMA_VERSIONS[CONFIG_KNOWN_SCHEMA_VERSIONS.length - 1],
    );
  });
});
