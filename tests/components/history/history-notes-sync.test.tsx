/**
 * The notes card follows its prop.
 *
 * It used to hold `useState(notes)`, a copy seeded on the first render and
 * never re-synced, so a note that changed after mount (the page's save writing
 * it back, another scan opened in the same view) never reached the card.
 *
 * renderToStaticMarkup cannot re-render an instance, so `useState` is stood in
 * for by a slot store that survives between two calls of the component, the
 * way React's own state survives a re-render. A card that copied its prop into
 * state would read the first value out of its slot on the second call.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

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
      return [slots.values[i], () => {}];
    },
  };
});

const { HistoryNotes } = await import("@/components/history/history-notes");

/** One render of the same instance: the slots carry over, the cursor resets. */
function render(notes: string): string {
  slots.cursor = 0;
  const tree = HistoryNotes({
    notes,
    isOwner: true,
    onSave: async () => null,
  }) as ReactElement;
  return renderToStaticMarkup(tree);
}

describe("HistoryNotes after its notes prop changes", () => {
  it("shows the new note, not the one it first rendered", () => {
    expect(render("First note")).toContain("First note");
    const second = render("Second note");
    expect(second).toContain("Second note");
    expect(second).not.toContain("First note");
  });

  it("goes back to the empty state when the note is cleared", () => {
    render("Something");
    const cleared = render("");
    expect(cleared).toContain("No notes yet.");
    expect(cleared).toContain("Add note");
  });
});
