/**
 * When a script may move focus (lib/hooks/use-focus-on-mount.ts).
 *
 * The hook itself needs a DOM; the rule it applies does not. A view that has
 * just replaced the one the person was in may take focus only when focus has
 * been dropped on <body> by the control that was removed. Focus on a real
 * element means the person went there themselves.
 */
import { describe, it, expect } from "vitest";
import { canTakeFocus } from "@/lib/hooks/use-focus-on-mount";

const body = { tagName: "BODY" } as unknown as Element;
const button = { tagName: "BUTTON" } as unknown as Element;

describe("canTakeFocus", () => {
  it("takes focus the removed control left on <body>", () => {
    expect(canTakeFocus(body, body)).toBe(true);
  });

  it("takes focus when nothing has it", () => {
    expect(canTakeFocus(null, body)).toBe(true);
  });

  it("leaves focus alone when the person is on a real element", () => {
    // They tabbed to Cancel, or to a header link: not ours to take back.
    expect(canTakeFocus(button, body)).toBe(false);
  });
});
