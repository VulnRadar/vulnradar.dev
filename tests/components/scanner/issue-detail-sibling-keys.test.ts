/**
 * Two elements that sit side by side in the finding panel must not carry the
 * same React key.
 *
 * This is not a style rule, it is the fix for a panel that multiplied on
 * screen. `IssueDetail` returns a static child list in which one slot is
 * conditional (`{verdict && ...}`, absent on every finding the AI verifier
 * has not run against). A `null` slot makes `updateSlot` return null, which
 * breaks React's positional fast path and drops reconciliation into
 * `mapRemainingChildren` -- a Map built as `set(fiber.key, fiber)`. Two
 * siblings sharing a key therefore collapse to ONE entry: the later fiber
 * overwrites the earlier one. On the next render the earlier element finds
 * the wrong fiber under its key, fails the `elementType` check, and is mounted
 * fresh, while its previous fiber is no longer in the map and so is never
 * added to the deletion list. The old DOM node stays, the new one is inserted
 * beside it, and the panel gains a copy on every re-render.
 *
 * That is exactly what "What the scanner saw" did once `<Evidence>` was given
 * `key={issue.id}` while `<RemediationControl>`, its sibling, already had it:
 * five identical evidence panels stacked above a single triage card, one more
 * for every triage click. Nothing warned, because React only reports
 * duplicate keys in development.
 *
 * Asserted over the source, like the other suites in this directory: the
 * repo's tsconfig sets `jsx: "preserve"`, so vitest cannot parse a `.tsx`
 * import and nothing in tests/ renders a component. See
 * tests/components/scanner/evidence-excerpt-render.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync("components/scanner/issue-detail.tsx", "utf8");

/**
 * Drops block comments and whole-line `//` comments. The file explains its own
 * keys in prose, so without this the extraction below reads a sentence about
 * `key={issue.id}` as a third sibling carrying that key.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** The body of IssueDetail itself, which is where the static child list is. */
const ISSUE_DETAIL_BODY = withoutComments(
  SOURCE.slice(
    SOURCE.indexOf("export function IssueDetail("),
    SOURCE.indexOf("function TaxonomyChip"),
  ),
);

/**
 * Removes every `.map(...)` callback, matching parentheses as it goes.
 *
 * A key inside a `.map()` is scoped to that one array, so `key={i}` appearing
 * in the fix-steps list and again in the references list is correct and must
 * not read as a collision. What is left afterwards is the static child list,
 * where every key shares a single parent.
 */
function withoutMappedChildren(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf(".map(", i);
    if (start === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, start);
    let depth = 0;
    let j = start + ".map".length;
    for (; j < source.length; j++) {
      if (source[j] === "(") depth++;
      else if (source[j] === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

/** Every `key={...}` expression left once the mapped children are gone. */
function staticSiblingKeys(source: string): string[] {
  return [...withoutMappedChildren(source).matchAll(/key=\{([^}]*)\}/g)].map(
    (m) => m[1].trim(),
  );
}

describe("issue detail: sibling keys", () => {
  it("gives every keyed static sibling in the finding panel its own key", () => {
    const keys = staticSiblingKeys(ISSUE_DETAIL_BODY);

    // Guards against the extraction silently matching nothing and the
    // uniqueness check below passing on an empty list.
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys the evidence panel apart from the remediation control", () => {
    // Both are keyed on purpose: each has expand/entry state that must not
    // survive a move to another finding. They just cannot be keyed the SAME,
    // or the evidence panel is the one that loses the map entry and gets
    // remounted-without-removal on every render.
    const evidenceKey = /<Evidence\s+key=\{([^}]*)\}/.exec(ISSUE_DETAIL_BODY);
    const remediationKey = /<RemediationControl\s+key=\{([^}]*)\}/.exec(
      ISSUE_DETAIL_BODY,
    );

    expect(evidenceKey).not.toBeNull();
    expect(remediationKey).not.toBeNull();
    expect(evidenceKey![1].trim()).not.toBe(remediationKey![1].trim());
  });

  it("still keys both on the finding, so opening another one resets them", () => {
    // The collision is fixed by namespacing the keys, not by dropping one:
    // without a key the panel keeps whichever lines were expanded and applies
    // that to content it was never about.
    const evidenceKey = /<Evidence\s+key=\{([^}]*)\}/.exec(ISSUE_DETAIL_BODY);
    const remediationKey = /<RemediationControl\s+key=\{([^}]*)\}/.exec(
      ISSUE_DETAIL_BODY,
    );

    expect(evidenceKey![1]).toContain("issue.id");
    expect(remediationKey![1]).toContain("issue.id");
  });
});
