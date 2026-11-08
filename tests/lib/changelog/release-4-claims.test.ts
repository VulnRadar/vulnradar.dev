import { describe, it, expect } from "vitest";
import { CHANGELOG } from "@/lib/changelog/data";

/**
 * The 4.0.0 block is written from what each piece of the release reported, and
 * nothing checks that the sentences stay true of the whole release. These are
 * the ones that claimed more than the code does.
 */
const release = CHANGELOG.find((r) => r.version === "4.0.0");

function desc(label: string): string {
  const entry = release?.changes.find((c) => c.label === label);
  if (!entry) throw new Error(`no 4.0.0 entry labelled ${label}`);
  return entry.desc;
}

describe("4.0.0 error code claims", () => {
  // `code` is added by ApiResponse.* and ApiResponse.fail. POST /scan and the
  // verify, bulk, crawl, status and single-history routes build their errors
  // with NextResponse.json and send none, so a line about every API error
  // promises a field those endpoints do not have.
  it("scopes the code to the errors the shared helpers send", () => {
    expect(desc("Error Codes on API Errors")).toMatch(
      /^Errors sent through the shared API helpers now include/,
    );
    expect(desc("Shared Error Codes for API v4")).toContain(
      "v3 errors sent through the shared API helpers keep every field",
    );
  });

  it("no longer reads as universal", () => {
    expect(desc("Error Codes on API Errors")).not.toMatch(/^API errors/);
    expect(desc("Shared Error Codes for API v4")).not.toContain(
      "v3 error bodies",
    );
  });
});

describe("4.0.0 sign-in destination", () => {
  // The client half and the server half of one feature were written as two
  // entries, and both told the reader the same three buttons keep the page.
  it("is one entry", () => {
    const about = (release?.changes ?? []).filter(
      (c) =>
        /destination|page you were heading to/i.test(c.desc) &&
        /Google, GitHub (and|or) Discord/.test(c.desc),
    );
    expect(about.map((c) => c.label)).toEqual([
      "Your Destination Survives Sign-Up and Provider Sign-In",
    ]);
  });
});

describe("4.0.0 team entries", () => {
  // Owner decision D7 builds team ownership transfer in this same release, so
  // an entry saying it cannot be done would ship contradicting another one.
  it("does not say ownership cannot be transferred", () => {
    for (const change of release?.changes ?? []) {
      expect(change.desc).not.toMatch(/ownership cannot be transferred/i);
    }
  });

  it("keeps the member_count change", () => {
    expect(desc("Team List Member Count")).toContain(
      "member_count as a number instead of a numeric string",
    );
  });
});
