/**
 * escapeCsv is the one CSV writer every client-side export in the app
 * shares (scan reports, the compare diff, and now the admin Engine
 * Feedback exports). It quotes per RFC 4180 -- and, since some of the
 * cells it now carries are free text somebody else typed (a feedback
 * note) or a URL somebody else chose, it also has to stop a spreadsheet
 * from executing what is in them.
 */
import { describe, it, expect } from "vitest";
import { escapeCsv } from "@/lib/ui/download";

describe("escapeCsv", () => {
  it("leaves an ordinary value alone", () => {
    expect(escapeCsv("Missing SPF Record")).toBe("Missing SPF Record");
    expect(escapeCsv("")).toBe("");
  });

  it("quotes and doubles per RFC 4180 when it has to", () => {
    expect(escapeCsv("a,b")).toBe('"a,b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv("line\nbreak")).toBe('"line\nbreak"');
  });

  it("neutralises a cell a spreadsheet would evaluate as a formula", () => {
    // Quoting alone does not help: the spreadsheet strips the quotes and
    // evaluates what is inside.
    expect(escapeCsv('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
    expect(escapeCsv("+1+1")).toBe("'+1+1");
    expect(escapeCsv("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsv("-2+3")).toBe("'-2+3");
    expect(escapeCsv("\tcmd")).toBe("'\tcmd");
  });

  it("still exports a plain negative number as a number", () => {
    expect(escapeCsv("-5")).toBe("-5");
    expect(escapeCsv("-0.25")).toBe("-0.25");
  });
});
