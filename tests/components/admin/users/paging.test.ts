import { describe, it, expect } from "vitest";
import { pageAfterEmpty } from "@/components/admin/users/paging";

/**
 * Deleting the last row on a page left an empty page past the end, with no
 * pagination and a false "No users have registered yet".
 */
describe("pageAfterEmpty", () => {
  it("steps back to the last page that has rows", () => {
    // Page 3 of 2: the third page's only account was just deleted.
    expect(pageAfterEmpty(3, 0, 20, 2)).toBe(2);
    expect(pageAfterEmpty(5, 0, 11, 2)).toBe(2);
  });

  it("leaves a page that has rows alone", () => {
    expect(pageAfterEmpty(3, 4, 24, 3)).toBeNull();
  });

  it("leaves an empty first page alone: it is genuinely empty", () => {
    expect(pageAfterEmpty(1, 0, 0, 0)).toBeNull();
  });

  it("leaves an empty list alone however far in the operator was", () => {
    expect(pageAfterEmpty(2, 0, 0, 0)).toBeNull();
  });

  it("never asks for the page that just came back empty", () => {
    // A server reporting rows but a stale page count must not loop.
    expect(pageAfterEmpty(2, 0, 5, 2)).toBeNull();
    expect(pageAfterEmpty(2, 0, 5, 9)).toBeNull();
  });

  it("goes to page 1 when the filters now leave one page", () => {
    expect(pageAfterEmpty(4, 0, 3, 1)).toBe(1);
    expect(pageAfterEmpty(4, 0, 3, 0)).toBe(1);
  });
});
