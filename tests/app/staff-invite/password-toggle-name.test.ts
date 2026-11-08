import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The show/hide control on the staff invite form is a toggle button, so
 * aria-pressed says whether it is on. A label that also flips announces
 * "Hide password, pressed", which reads as a contradiction.
 */
describe("the staff invite password toggle", () => {
  it("does not change its accessible name while aria-pressed reports the state", () => {
    const source = readFileSync(
      join(process.cwd(), "app/staff-invite/[token]/page.tsx"),
      "utf8",
    );
    expect(source).toContain("<PasswordToggle");
    expect(source).toContain("shown={showPass}");
    expect(source).not.toMatch(/aria-label=\{showPass/);
  });
});
