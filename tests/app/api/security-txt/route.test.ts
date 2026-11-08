/**
 * GET /api/security-txt, the one source of /.well-known/security.txt and
 * /security.txt (RFC 9116). Only the settings resolver is mocked.
 */
import { describe, it, expect, vi } from "vitest";
import { APP_URL } from "@/lib/config/constants";

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "SECURITY_EMAIL" ? "disclosure@operator.test" : undefined,
  ),
}));

const { GET } = await import("@/app/api/security-txt/route");

function field(body: string, name: string): string[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith(`${name}: `))
    .map((line) => line.slice(name.length + 2));
}

describe("GET /api/security-txt", () => {
  it("is served as plain text and cached for a day", async () => {
    const res = await GET();

    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it("takes the contact from the SECURITY_EMAIL setting", async () => {
    const body = await (await GET()).text();

    expect(field(body, "Contact")).toContain("mailto:disclosure@operator.test");
    expect(body).not.toContain("security@vulnradar.dev");
  });

  // On a fixed clock, because the milliseconds are dropped: a value exactly a
  // year out also lands below "now plus a year" whenever the clock is mid-second.
  it("expires one day short of a year out, as the RFC recommends", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-03-15T12:00:00.500Z"),
    });
    try {
      const body = await (await GET()).text();

      expect(field(body, "Expires")).toEqual(["2027-03-14T12:00:00.000Z"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("points Policy at the site's security page and Acknowledgments at the changelog", async () => {
    const body = await (await GET()).text();

    expect(field(body, "Policy")).toEqual([`${APP_URL}/security`]);
    expect(field(body, "Acknowledgments")).toEqual([`${APP_URL}/changelog`]);
    expect(field(body, "Canonical")).toEqual([
      `${APP_URL}/.well-known/security.txt`,
    ]);
  });

  it("carries no Encryption field, because no key exists to publish", async () => {
    const body = await (await GET()).text();

    expect(field(body, "Encryption")).toEqual([]);
  });
});
