import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  NOTIFICATION_COLUMNS,
  type NotificationType,
} from "@/lib/notifications/columns";

/**
 * Every email preference has to be able to stop a real email.
 *
 * "Critical findings" and "Team invitations" both sat on the profile page and
 * on /unsubscribe, reported "Saved" and changed nothing, because no code ever
 * sent mail under those types. A person who turned one off still got the mail,
 * and a person who left one on was waiting for an alert that did not exist.
 * Nothing in the type system notices: a key in NOTIFICATION_COLUMNS with no
 * sender compiles exactly like one with ten.
 *
 * So every type must appear as the `type` of a sendNotificationEmail call
 * somewhere in app/ or lib/, read from the syntax tree so a comment or a test
 * fixture mentioning the name does not count.
 */

/**
 * Sent by the admin broadcast composer rather than by sendNotificationEmail,
 * which filters its audience on the preference column. An entry here has to
 * name a column the composer offers, so it cannot outlive that route.
 */
const BROADCAST_ONLY: Partial<Record<NotificationType, string>> = {
  product_updates: "email_product_updates",
  tips_guides: "email_tips_guides",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(dir, file));
}

/** The string literals in the `type` property of each call in a file. */
function producerTypes(path: string, source: string): string[] {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];

  function literalsIn(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) found.push(node.text);
    ts.forEachChild(node, literalsIn);
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "sendNotificationEmail"
    ) {
      const [arg] = node.arguments;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const property of arg.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText(file) === "type"
          ) {
            // Walks the initializer so `type: isOwner ? "a" : "b"` counts both.
            literalsIn(property.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return found;
}

function allProducerTypes(): Set<string> {
  const producers = new Set<string>();
  for (const path of [...sourceFiles("app"), ...sourceFiles("lib")]) {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    if (!source.includes("sendNotificationEmail(")) continue;
    for (const type of producerTypes(path, source)) producers.add(type);
  }
  return producers;
}

describe("notification producers", () => {
  const producers = allProducerTypes();
  const types = Object.keys(NOTIFICATION_COLUMNS) as NotificationType[];

  it("finds the sends it is meant to find", () => {
    // Guards the walk itself: an empty set would make the next test fail on
    // everything, and a walk reading the wrong property would pass nothing.
    expect(producers.has("scan_complete")).toBe(true);
    expect(producers.has("login_alerts")).toBe(true);
  });

  it.each(types.filter((type) => !(type in BROADCAST_ONLY)))(
    "%s has a sender in app/ or lib/",
    (type) => {
      expect(producers.has(type)).toBe(true);
    },
  );

  it("keeps broadcast-only categories on the composer's audience list", () => {
    const composer = readFileSync(
      join(process.cwd(), "components/admin/features/mass-email-manager.tsx"),
      "utf8",
    );
    for (const [type, column] of Object.entries(BROADCAST_ONLY)) {
      expect(NOTIFICATION_COLUMNS[type as NotificationType]).toBe(column);
      expect(composer).toContain(`value: "${column}"`);
    }
  });

  it("names no type that does not exist", () => {
    for (const type of producers) {
      expect(types as string[]).toContain(type);
    }
  });
});
