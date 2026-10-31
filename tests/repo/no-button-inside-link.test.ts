import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { nestedButtons } from "./_nested-buttons";

/**
 * A link does not wrap a button. A control that navigates is
 * `<Button asChild><Link href=...>label</Link></Button>`, which renders one
 * anchor wearing the button's classes.
 *
 * `<Link href=...><Button>label</Button></Link>` renders `<a><button>`:
 * interactive content inside an anchor is invalid HTML, and it leaves two tab
 * stops on one control. Only the inner button draws a focus ring, so the first
 * stop on every such CTA was invisible. There were eight files doing it across
 * the landing page, the top bar, /pricing, /demo and the footer, which is why
 * this is a test and not a note in STYLE.md.
 *
 * The nav's login link was the worst case: `hidden sm:inline-flex` sat on the
 * BUTTON, so below 640px the button was display:none but the anchor around it
 * still rendered, with no text, and still took keyboard focus. With asChild the
 * class lands on the anchor itself and the whole control goes away.
 *
 * The scanner is in ./_nested-buttons.ts; the first describe block below pins
 * its edge cases so a tweak to it cannot quietly stop catching the real ones.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const SCANNED = ["app", "components", "lib"];

/** Just the lines, for the scanner cases below. */
function buttonsInsideAnchors(source: string): number[] {
  return nestedButtons(source).map((n) => n.line);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/**
 * Plain `<a href target="_blank"><Button>` pairs that predate this test. They
 * are the same defect as the `<Link>` form and are listed rather than ignored:
 * the last test below fails when an entry no longer matches, so fixing a file
 * means deleting its line here, and the list can only shrink.
 *
 * It is empty now: the last two (the "Visit site" button on /host and
 * /shared) went to `<Button asChild><a>`.
 */
const KNOWN_ANCHOR_WRAPPERS: string[] = [];

describe("a link never wraps a button", () => {
  describe("the scanner", () => {
    it("flags a button as the first child of a Link", () => {
      expect(
        buttonsInsideAnchors(`<Link href="/x"><Button>Go</Button></Link>`),
      ).toEqual([1]);
      expect(
        buttonsInsideAnchors(
          `<Link href="/x">\n  <button>Go</button>\n</Link>`,
        ),
      ).toEqual([1]);
    });

    it("sees through an attribute that contains a >", () => {
      // The case a `[^>]*` regex misses: the arrow function's `>` ends its
      // match early and the button after the real tag is never reached.
      const source = [
        "<Link",
        '  href="/login"',
        "  onClick={() => setOpen(false)}",
        ">",
        '  <Button variant="outline">Log in</Button>',
        "</Link>",
      ].join("\n");
      expect(buttonsInsideAnchors(source)).toEqual([1]);
    });

    it("sees through a template literal href", () => {
      const source =
        "<Link href={`/checks/${key}?a=1&b=${n > 2 ? 1 : 0}`}>\n<Button>Go</Button></Link>";
      expect(buttonsInsideAnchors(source)).toEqual([1]);
    });

    it("skips a JSX comment between the link and the button", () => {
      expect(
        buttonsInsideAnchors(
          `<Link href="/x">\n  {/* the primary action */}\n  <Button>Go</Button>\n</Link>`,
        ),
      ).toEqual([1]);
    });

    it("flags a plain anchor and an aliased Link", () => {
      expect(
        buttonsInsideAnchors(`<a href="/x" target="_blank"><Button /></a>`),
      ).toEqual([1]);
      expect(
        buttonsInsideAnchors(`<NextLink href="/x"><Button /></NextLink>`),
      ).toEqual([1]);
    });

    it("reports the line the anchor opens on", () => {
      const source = [
        "<div>",
        "  <p>x</p>",
        '  <Link href="/x">',
        "    <Button />",
        "  </Link>",
        "</div>",
      ].join("\n");
      expect(buttonsInsideAnchors(source)).toEqual([3]);
    });

    it("accepts Button asChild around a Link", () => {
      expect(
        buttonsInsideAnchors(
          `<Button asChild size="lg"><Link href="/x">Go</Link></Button>`,
        ),
      ).toEqual([]);
    });

    it("accepts a link whose first child is not a button", () => {
      expect(
        buttonsInsideAnchors(
          `<Link href="/x"><span>Go</span> <Button>later</Button></Link>`,
        ),
      ).toEqual([]);
      expect(buttonsInsideAnchors(`<Link href="/x">Go</Link>`)).toEqual([]);
    });

    it("ignores a self-closing link and prose in a comment", () => {
      expect(
        buttonsInsideAnchors(`<Link href="/x" />\n<Button>Go</Button>`),
      ).toEqual([]);
      expect(
        buttonsInsideAnchors(
          `// The second used to be a <Link> wrapped around a <Button>, which`,
        ),
      ).toEqual([]);
    });

    it("does not mistake <article> or <aside> for an anchor", () => {
      expect(
        buttonsInsideAnchors(`<article><Button>Go</Button></article>`),
      ).toEqual([]);
      expect(
        buttonsInsideAnchors(`<aside>\n<button>Go</button></aside>`),
      ).toEqual([]);
    });
  });

  const files = SCANNED.flatMap((d) => sourceFiles(path.join(ROOT, d)));

  /** `file:line` for every nested button under the given tags. */
  function offenders(tags: string[], skip: string[] = []): string[] {
    const out: string[] = [];
    for (const file of files) {
      if (skip.includes(rel(file))) continue;
      const source = readFileSync(file, "utf8");
      for (const { tag, line } of nestedButtons(source)) {
        if (tags.includes(tag)) out.push(`${rel(file)}:${line}`);
      }
    }
    return out;
  }

  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("renders no button inside a Link", () => {
    expect(
      offenders(["Link", "NextLink"]),
      "wrap the link instead: <Button asChild><Link href=...>label</Link></Button>",
    ).toEqual([]);
  });

  it("renders no button inside a plain anchor, beyond the known list", () => {
    expect(
      offenders(["a"], KNOWN_ANCHOR_WRAPPERS),
      "wrap the anchor instead: <Button asChild><a href=...>label</a></Button>",
    ).toEqual([]);
  });

  it("keeps the known list honest", () => {
    const fixed = KNOWN_ANCHOR_WRAPPERS.filter(
      (file) =>
        nestedButtons(readFileSync(path.join(ROOT, file), "utf8")).length === 0,
    );
    expect(
      fixed,
      "these no longer nest a button in an anchor: delete them from KNOWN_ANCHOR_WRAPPERS",
    ).toEqual([]);
  });
});
