/**
 * A layout that sets `title` as a plain string consumes the root template and
 * hands none to its children, so everything beneath it renders a title with no
 * site name. /docs/api did that to /docs/api/playground, whose tab read
 * differently from its own Open Graph title.
 *
 * Structural rather than rendered: the resolved <title> needs a built app. What
 * can be pinned is the shape that causes it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { metadata as docsApiMetadata } from "@/app/docs/api/layout";

const APP_DIR = path.resolve(__dirname, "../../../app");

const rel = (file: string) =>
  path.relative(APP_DIR, file).split(path.sep).join("/");

function layoutsUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return layoutsUnder(full);
    return entry.name === "layout.tsx" ? [full] : [];
  });
}

function hasDescendantRoute(dir: string): boolean {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .some((entry) => {
      const child = path.join(dir, entry.name);
      return (
        ["page.tsx", "layout.tsx"].some((f) =>
          fs.existsSync(path.join(child, f)),
        ) || hasDescendantRoute(child)
      );
    });
}

function setsPlainTitle(source: string): boolean {
  if (/\bisSectionRoot:\s*true\b/.test(source)) return false;
  if (/\btemplate:/.test(source)) return false;
  return /\b(?:privatePageMetadata|pageMetadata)\(|^\s*title:/m.test(source);
}

/**
 * The same shape, on signed-in pages only. Empty now that privatePageMetadata
 * can opt in, and it only shrinks: an entry that stops being an offender fails
 * below.
 */
const PRIVATE_SECTIONS_WITHOUT_OPT_IN: string[] = [];

const offenders = layoutsUnder(APP_DIR)
  .filter(
    (file) =>
      setsPlainTitle(fs.readFileSync(file, "utf8")) &&
      hasDescendantRoute(path.dirname(file)),
  )
  .map(rel)
  .sort();

describe("section roots", () => {
  it("every layout with routes beneath it passes a title template down", () => {
    expect(offenders).toEqual(PRIVATE_SECTIONS_WITHOUT_OPT_IN);
  });

  it("/docs/api gives the playground its site name", () => {
    expect(docsApiMetadata.title).toMatchObject({
      default: expect.any(String),
      template: expect.stringContaining("%s"),
    });
  });

  it("recognises the shapes it is looking for", () => {
    expect(setsPlainTitle('pageMetadata({ title: "A" })')).toBe(true);
    expect(setsPlainTitle('privatePageMetadata("A", "/a")')).toBe(true);
    expect(setsPlainTitle("isSectionRoot: true, pageMetadata({})")).toBe(false);
    expect(setsPlainTitle("export default function Layout() {}")).toBe(false);
  });
});
