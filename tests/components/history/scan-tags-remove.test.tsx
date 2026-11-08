/**
 * A failed tag remove says so, beside the chips.
 *
 * The remove handler wrote its failure into the add input's error slot, which
 * only rendered while that input was open, so a remove the server refused
 * left the chip in place and said nothing.
 *
 * renderToStaticMarkup cannot re-render an instance, so `useState` is stood in
 * for by a slot store that survives between calls of the component and whose
 * setters write to it, the way React's state survives a re-render. The remove
 * button's own onClick is found in the tree and run, then the row is rendered
 * again from the same slots.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ScanTag } from "@/components/history/history-types";

const slots = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = slots.cursor++;
      if (!(i in slots.values)) {
        slots.values[i] =
          typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
      }
      const set = (next: unknown) => {
        slots.values[i] =
          typeof next === "function"
            ? (next as (prev: unknown) => unknown)(slots.values[i])
            : next;
      };
      return [slots.values[i], set];
    },
  };
});

const { ScanTags } = await import("@/components/history/scan-tags");

const TAGS: ScanTag[] = [{ tag: "staging", source: "user" }];

function findProps(
  node: unknown,
  match: (props: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const props = (node as { props: Record<string, unknown> }).props;
  if (match(props)) return props;
  return findProps(props.children, match);
}

function renderRow(onRemove: () => Promise<string | null>): ReactElement {
  slots.cursor = 0;
  return ScanTags({
    scanId: "abc",
    tags: TAGS,
    onAdd: async () => null,
    onRemove,
  }) as ReactElement;
}

describe("removing a tag", () => {
  it("shows the server's refusal in an alert beside the chips", async () => {
    slots.values.length = 0;
    const onRemove = vi.fn(async () => "Couldn't remove that tag.");
    const first = renderRow(onRemove);
    expect(renderToStaticMarkup(first)).not.toContain('role="alert"');

    const remove = findProps(
      first,
      (p) => p["aria-label"] === "Remove tag staging",
    ) as { onClick: () => Promise<void> };
    await remove.onClick();
    expect(onRemove).toHaveBeenCalledWith("abc", "staging");

    const html = renderToStaticMarkup(renderRow(onRemove));
    expect(html).toMatch(
      /<span role="alert"[^>]*>Couldn&#x27;t remove that tag\.<\/span>/,
    );
    // The add dialog was never opened to show it.
    expect(html).not.toContain("<input");
  });

  it("shows nothing when the remove went through", async () => {
    slots.values.length = 0;
    const onRemove = vi.fn(async () => null);
    const first = renderRow(onRemove);
    const remove = findProps(
      first,
      (p) => p["aria-label"] === "Remove tag staging",
    ) as { onClick: () => Promise<void> };
    await remove.onClick();
    expect(renderToStaticMarkup(renderRow(onRemove))).not.toContain(
      'role="alert"',
    );
  });
});
