/**
 * InlineAlert announces itself by tone, and a standing notice can opt out.
 *
 * The component set role="alert" on every error and warning, so the six
 * limit and cancellation notices on the billing tab were read out assertively
 * as soon as the tab opened, before the user had done anything. `live` lets a
 * notice that is simply true of the page say so.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InlineAlert,
  alertRole,
  type InlineAlertTone,
} from "@/components/shared/inline-alert";

const TONES: InlineAlertTone[] = ["error", "warning", "success", "info"];

function html(
  tone: InlineAlertTone,
  live?: "assertive" | "polite" | "off",
): string {
  return renderToStaticMarkup(
    <InlineAlert tone={tone} live={live}>
      Daily scan limit reached.
    </InlineAlert>,
  );
}

describe("alertRole", () => {
  it("keeps the tone default when live is omitted", () => {
    expect(alertRole("error")).toBe("alert");
    expect(alertRole("warning")).toBe("alert");
    expect(alertRole("success")).toBe("status");
    expect(alertRole("info")).toBe("status");
  });

  it("lets live override the tone either way", () => {
    expect(alertRole("info", "assertive")).toBe("alert");
    expect(alertRole("error", "polite")).toBe("status");
  });

  it("drops the role entirely for off, whatever the tone", () => {
    for (const tone of TONES) expect(alertRole(tone, "off")).toBeUndefined();
  });
});

describe("InlineAlert markup", () => {
  it("renders role=alert for an error and a warning by default", () => {
    expect(html("error")).toContain('role="alert"');
    expect(html("warning")).toContain('role="alert"');
  });

  it("renders role=status for a success and an info line by default", () => {
    expect(html("success")).toContain('role="status"');
    expect(html("info")).toContain('role="status"');
  });

  it("renders no live role at all for live=off", () => {
    for (const tone of TONES) {
      const out = html(tone, "off");
      expect(out).not.toContain("role=");
      expect(out).toContain("Daily scan limit reached.");
    }
  });

  it("renders a polite status for a warning that asks for it", () => {
    expect(html("warning", "polite")).toContain('role="status"');
  });
});

describe("the billing tab's standing notices", () => {
  const src = readFileSync(
    join(process.cwd(), "components/profile/tabs/profile-billing-tab.tsx"),
    "utf8",
  );

  it("are all quiet", () => {
    const alerts = src.match(/<InlineAlert\b[^>]*>/g) ?? [];
    expect(alerts.length).toBe(6);
    for (const tag of alerts) expect(tag).toContain('live="off"');
  });
});
