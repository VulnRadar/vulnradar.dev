import { describe, expect, it } from "vitest";
import {
  COMPOSE_FILES,
  blocksNamed,
  emptyStringDefaults,
  readCompose,
} from "./_compose";

/**
 * A `NAME: ${NAME:-}` line under `environment:` turns "not set" into "set to
 * the empty string". lib/config/env.ts validates a set value, so an empty
 * CONTACT_EMAIL or SUPPORT_EMAIL failed the startup email check and the quick
 * start crash-looped. env_file already forwards whatever .env really sets.
 *
 * build.args are exempt: an ARG has to be passed to exist, and the consumers
 * treat an empty one as absent.
 */
describe("compose environment entries", () => {
  it.each(COMPOSE_FILES)("%s has an environment map to check", (file) => {
    expect(
      blocksNamed(readCompose(file), "environment")
        .flat()
        .map((e) => e.key),
    ).toContain("DATABASE_URL");
  });

  it.each(COMPOSE_FILES)("%s defaults none of them to empty", (file) => {
    expect(emptyStringDefaults(readCompose(file))).toEqual([]);
  });
});

describe("emptyStringDefaults", () => {
  const compose = (body: string) =>
    ["services:", "  app:", "    environment:", body].join("\n");

  it("catches both spellings of an empty default", () => {
    expect(
      emptyStringDefaults(
        compose(
          [
            "      CONTACT_EMAIL: ${CONTACT_EMAIL:-}",
            "      SUPPORT_EMAIL: ${SUPPORT_EMAIL-}",
          ].join("\n"),
        ),
      ),
    ).toEqual(["CONTACT_EMAIL", "SUPPORT_EMAIL"]);
  });

  it("catches the list form", () => {
    expect(
      emptyStringDefaults(compose("      - CONTACT_EMAIL=${CONTACT_EMAIL:-}")),
    ).toEqual(["CONTACT_EMAIL"]);
  });

  it("allows a real default and a required variable", () => {
    expect(
      emptyStringDefaults(
        compose(
          [
            "      SMTP_PORT: ${SMTP_PORT:-587}",
            "      KEY: ${KEY:?Set KEY in .env}",
            "      PLAIN: ${PLAIN}",
          ].join("\n"),
        ),
      ),
    ).toEqual([]);
  });

  it("does not read build.args as environment", () => {
    expect(
      emptyStringDefaults(
        [
          "services:",
          "  app:",
          "    build:",
          "      args:",
          "        NEXT_PUBLIC_X: ${NEXT_PUBLIC_X:-}",
          "    environment:",
          "      NODE_ENV: production",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
