import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  appSourceFiles,
  findInfoHintsInSource,
  handRolledHintsInSource,
  hoverOnlyTitlesInSource,
  type HintUse,
} from "./_info-hint-ast";

/**
 * How InfoHint may be used, and two ratchets for the places that still explain
 * something the old way.
 *
 * The rules come from the component's own constraints, not taste:
 *   - the panel is portalled to the end of body and is not in the tab order, so
 *     a link or button inside it is unreachable by keyboard;
 *   - a button inside a heading, a link, another button or a label becomes part
 *     of that element's name, and nested interactive content is invalid;
 *   - ten buttons all named "More information" cannot be told apart in a screen
 *     reader's control list (WCAG 2.4.6).
 *
 * The ratchets can only shrink. A baseline entry that stops matching fails the
 * test, so fixing a file means deleting its line here, never adding one.
 */

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const MIDDLE_DOT = String.fromCharCode(0x00b7);

const FORBIDDEN_ANCESTORS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "button",
  "Button",
  "a",
  "Link",
  "label",
  "Label",
  "summary",
  "TabsTrigger",
  "AccordionTrigger",
  "CollapsibleTrigger",
  "DropdownMenuItem",
  "SelectItem",
]);

const FORBIDDEN_CHILDREN = new Set([
  "a",
  "Link",
  "button",
  "Button",
  "input",
  "select",
  "InfoHint",
]);

const GENERIC_LABEL = /^(more )?(info|information|help|details)$/i;
const SIZES = new Set(["sm", "md", "lg"]);

/** Every rule a single hint has to meet, as readable messages. */
function violations(use: HintUse): string[] {
  const out: string[] = [];
  if (!use.hasLabel) out.push("has no label");
  if (use.label !== null && GENERIC_LABEL.test(use.label.trim())) {
    out.push(`label "${use.label}" does not name the thing it explains`);
  }
  for (const tag of use.ancestors) {
    if (FORBIDDEN_ANCESTORS.has(tag)) out.push(`sits inside <${tag}>`);
  }
  for (const tag of use.childTags) {
    if (FORBIDDEN_CHILDREN.has(tag)) out.push(`contains <${tag}>`);
  }
  const texts = [...use.childText, ...(use.label ? [use.label] : [])];
  for (const text of texts) {
    for (const [name, ch] of [
      ["an em dash", EM_DASH],
      ["an en dash", EN_DASH],
      ["a middle dot", MIDDLE_DOT],
    ] as const) {
      if (text.includes(ch)) out.push(`text has ${name}`);
    }
  }
  if (use.size !== null && !SIZES.has(use.size)) {
    out.push(`size "${use.size}" is not sm, md or lg`);
  }
  return out;
}

function violationsIn(source: string): string[] {
  return findInfoHintsInSource(source).flatMap(violations);
}

describe("InfoHint usage rules: the checker", () => {
  it("passes a well-formed hint beside a heading", () => {
    expect(
      violationsIn(`
        <div className="flex items-center gap-2">
          <h1>Attack surface</h1>
          <InfoHint label="About your attack surface" size="lg">
            <span className="block">Verifying a domain proves you own it.</span>
          </InfoHint>
        </div>`),
    ).toEqual([]);
  });

  it("accepts a translated label expression", () => {
    expect(
      violationsIn(
        `<InfoHint label={t("aboutLabel", { topic })}>Text.</InfoHint>`,
      ),
    ).toEqual([]);
  });

  it("flags a missing label", () => {
    expect(violationsIn(`<InfoHint>Text.</InfoHint>`)).toContain(
      "has no label",
    );
  });

  it.each(["More information", "Info", "Help", "details", "More details"])(
    "flags the generic label %s",
    (label) => {
      expect(
        violationsIn(`<InfoHint label="${label}">Text.</InfoHint>`).join(),
      ).toContain("does not name the thing");
    },
  );

  it.each([
    "h1",
    "h2",
    "h4",
    "button",
    "Button",
    "a",
    "Link",
    "label",
    "Label",
  ])("flags a hint inside <%s>", (tag) => {
    expect(
      violationsIn(
        `<${tag}>Name<InfoHint label="About name">Text.</InfoHint></${tag}>`,
      ),
    ).toContain(`sits inside <${tag}>`);
  });

  it("flags a hint inside a trigger or menu item", () => {
    for (const tag of ["TabsTrigger", "SelectItem", "DropdownMenuItem"]) {
      expect(
        violationsIn(
          `<${tag}><InfoHint label="About it">Text.</InfoHint></${tag}>`,
        ),
      ).toContain(`sits inside <${tag}>`);
    }
  });

  it.each(["a", "Link", "button", "Button", "input", "select"])(
    "flags <%s> inside the panel",
    (tag) => {
      expect(
        violationsIn(
          `<InfoHint label="About it">See <${tag} href="/x">this</${tag}>.</InfoHint>`,
        ),
      ).toContain(`contains <${tag}>`);
    },
  );

  it("flags a hint inside a hint", () => {
    expect(
      violationsIn(
        `<InfoHint label="About a"><InfoHint label="About b">x</InfoHint></InfoHint>`,
      ),
    ).toContain("contains <InfoHint>");
  });

  it("flags an em dash, an en dash and a middle dot in the text or the label", () => {
    expect(
      violationsIn(`<InfoHint label="About it">One ${EM_DASH} two.</InfoHint>`),
    ).toContain("text has an em dash");
    expect(
      violationsIn(`<InfoHint label="About it">1${EN_DASH}2</InfoHint>`),
    ).toContain("text has an en dash");
    expect(
      violationsIn(`<InfoHint label="About it">a ${MIDDLE_DOT} b</InfoHint>`),
    ).toContain("text has a middle dot");
    expect(
      violationsIn(`<InfoHint label="About ${EM_DASH} it">x</InfoHint>`),
    ).toContain("text has an em dash");
  });

  it("flags a literal size that is not sm, md or lg", () => {
    expect(
      violationsIn(`<InfoHint label="About it" size="xl">x</InfoHint>`),
    ).toContain('size "xl" is not sm, md or lg');
    expect(
      violationsIn(`<InfoHint label="About it" size="lg">x</InfoHint>`),
    ).toEqual([]);
  });
});

const FILES = appSourceFiles();

describe("InfoHint usage rules: every call site in app/ and components/", () => {
  it("scans the tree", () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  it("meets every rule", () => {
    const bad: string[] = [];
    for (const rel of FILES) {
      const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (!source.includes("<InfoHint")) continue;
      for (const use of findInfoHintsInSource(source)) {
        for (const v of violations(use)) bad.push(`${rel}:${use.line} ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * Hand-rolled "icon opens a popover" buttons that predate InfoHint. The three
 * call sites in scan-summary.tsx are replaced by hint-scanner-ui; that cluster
 * deletes this entry in its last commit.
 */
const HAND_ROLLED: string[] = ["components/scanner/scan-summary.tsx"];

/**
 * A `title` of 40 characters or more on an element that is not a control.
 * Hover-only: never shown on touch, not reliably announced. Keys are file plus
 * the first 30 characters of the title, never line numbers, so a refactor that
 * moves the line does not break the list. Forty characters is where a title
 * stops being a label and becomes an explanation.
 */
const HOVER_ONLY_TITLE: string[] = [
  "components/assets/asset-row.tsx::Latest scan is private -- view",
  "components/history/scan-tags.tsx::Detected automatically from th",
  "components/profile/tabs/developer/api-keys-section.tsx::Created before scopes existed,",
  "components/profile/tabs/developer/webhooks-section.tsx::The full address is visible to",
  "components/shares/shares-row.tsx::Listed in the public /public-s",
];

describe("hand-rolled hint buttons (ratchet)", () => {
  it("recognises a button with an aria-label that holds a help icon", () => {
    expect(
      handRolledHintsInSource(`
        <PopoverTrigger asChild>
          <button aria-label="What does it mean?"><HelpCircle /></button>
        </PopoverTrigger>`).map((h) => h.tag),
    ).toEqual(["button"]);
    expect(
      handRolledHintsInSource(
        `<PopoverTrigger aria-label="Why?"><CircleHelp /></PopoverTrigger>`,
      ).map((h) => h.tag),
    ).toEqual(["PopoverTrigger"]);
    expect(
      handRolledHintsInSource(
        `<button aria-label="Info"><Info aria-hidden /></button>`,
      ),
    ).toHaveLength(1);
  });

  it("leaves a plain icon button and a labelled non-help button alone", () => {
    expect(handRolledHintsInSource(`<button><Info /></button>`)).toHaveLength(
      0,
    );
    expect(
      handRolledHintsInSource(`<button aria-label="Close"><X /></button>`),
    ).toHaveLength(0);
  });

  const hits = new Set<string>();
  for (const rel of FILES) {
    if (rel === "components/shared/info-hint.tsx") continue;
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (!/aria-label/.test(source)) continue;
    if (handRolledHintsInSource(source).length > 0) hits.add(rel);
  }

  it("has no hand-rolled hint outside the baseline", () => {
    expect([...hits].filter((f) => !HAND_ROLLED.includes(f))).toEqual([]);
  });

  it("drops a baseline entry once its file is fixed", () => {
    expect(HAND_ROLLED.filter((f) => !hits.has(f))).toEqual([]);
  });
});

describe("hover-only titles (ratchet)", () => {
  const long = "x".repeat(41);

  it("flags a long title on a non-control and keys it by its text", () => {
    expect(
      hoverOnlyTitlesInSource(`<span title="${long}">a</span>`).map(
        (t) => t.key,
      ),
    ).toEqual(["x".repeat(30)]);
    expect(
      hoverOnlyTitlesInSource(`<td title={\`${long} \${n}\`}>a</td>`),
    ).toHaveLength(1);
  });

  it("leaves a short title, a title on a control, on a link and on a focusable handle alone", () => {
    expect(
      hoverOnlyTitlesInSource(`<span title="Copy to clipboard">a</span>`),
    ).toHaveLength(0);
    expect(
      hoverOnlyTitlesInSource(`<button title="${long}">a</button>`),
    ).toHaveLength(0);
    expect(hoverOnlyTitlesInSource(`<a title="${long}">a</a>`)).toHaveLength(0);
    expect(
      hoverOnlyTitlesInSource(
        `<div role="separator" tabIndex={0} title="${long}" />`,
      ),
    ).toHaveLength(0);
  });

  const hits = new Set<string>();
  for (const rel of FILES) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (!/title=/.test(source)) continue;
    for (const t of hoverOnlyTitlesInSource(source)) {
      hits.add(`${rel}::${t.key}`);
    }
  }

  it("has no hover-only title outside the baseline", () => {
    expect([...hits].filter((k) => !HOVER_ONLY_TITLE.includes(k))).toEqual([]);
  });

  it("drops a baseline entry once its title is fixed", () => {
    expect(HOVER_ONLY_TITLE.filter((k) => !hits.has(k))).toEqual([]);
  });
});
