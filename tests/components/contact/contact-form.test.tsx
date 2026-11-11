// @vitest-environment jsdom
/**
 * The public contact form's limits, autofill and the security note.
 *
 * The route refused long input with "Message is too long." and the form never
 * said there was a limit, on the page a security reporter is most likely to
 * write at length. The form now gets the limits the route enforces, caps each
 * field at its own, and counts the message as it is typed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/shared/turnstile-widget", () => ({
  TurnstileWidget: () => null,
}));

const { ContactForm, staffApplicationMessage } =
  await import("@/components/contact/contact-form");
const { CONFIG_CONTACT_MESSAGE_MAX_LENGTH } =
  await import("@/lib/config/config-values");
const { SECURITY_ACK_HOURS } = await import("@/lib/security/response-times");

const realFetch = globalThis.fetch;

beforeEach(() => {
  // The form asks who is signed in to prefill the address; nobody is.
  globalThis.fetch = vi.fn(
    async () => new Response("{}", { status: 401 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function renderForm(
  category = "bug",
  limits?: { name: number; subject: number; message: number },
) {
  return render(
    <ContactForm
      category={category}
      onSuccess={() => {}}
      onError={() => {}}
      limits={limits}
    />,
  );
}

function messageField(): HTMLTextAreaElement {
  return document.getElementById("contact-message") as HTMLTextAreaElement;
}

describe("ContactForm limits", () => {
  it("caps the message at the limit it is given", () => {
    renderForm("bug", { name: 120, subject: 160, message: 1234 });
    expect(messageField().maxLength).toBe(1234);
  });

  it("falls back to the setting's default when no limit is passed", () => {
    renderForm();
    expect(messageField().maxLength).toBe(CONFIG_CONTACT_MESSAGE_MAX_LENGTH);
  });

  it("caps the name and subject at the route's limits", () => {
    renderForm("bug", { name: 120, subject: 160, message: 5000 });
    expect(
      (document.getElementById("contact-name") as HTMLInputElement).maxLength,
    ).toBe(120);
    expect(
      (document.getElementById("contact-subject") as HTMLInputElement)
        .maxLength,
    ).toBe(160);
  });

  it("counts the message as it is typed, and ties the count to the field", () => {
    renderForm("bug", { name: 120, subject: 160, message: 1234 });
    expect(screen.getByText("0 of 1234 characters")).toBeTruthy();

    fireEvent.change(messageField(), { target: { value: "hello" } });

    const count = screen.getByText("5 of 1234 characters");
    expect(messageField().getAttribute("aria-describedby")).toBe(count.id);
  });

  it("leaves room for the lines a staff application adds above the message", () => {
    renderForm("staff_application", { name: 120, subject: 160, message: 1000 });
    const overhead = staffApplicationMessage(undefined, "", "", "").length;
    expect(overhead).toBeGreaterThan(0);
    expect(messageField().maxLength).toBe(1000 - overhead);
  });
});

describe("ContactForm autofill (WCAG 1.3.5)", () => {
  it("marks the name and email fields for the browser's autofill", () => {
    renderForm();
    expect(
      document.getElementById("contact-name")?.getAttribute("autocomplete"),
    ).toBe("name");
    expect(
      document.getElementById("contact-email")?.getAttribute("autocomplete"),
    ).toBe("email");
  });
});

describe("the security acknowledgement promise", () => {
  // The form said 24 hours, SECURITY.md and /security said 48, and the
  // confirmation mail said "24 to 48": three commitments for one event.
  it("states the same number of hours as SECURITY.md", () => {
    const securityMd = readFileSync(
      path.join(process.cwd(), "SECURITY.md"),
      "utf8",
    );
    const table = securityMd.match(/Acknowledg\w*\s*\|\s*<\s*(\d+)\s*hours/i);
    expect(table).not.toBeNull();
    const documented = Number(table?.[1]);
    expect(SECURITY_ACK_HOURS).toBe(documented);

    renderForm("security");
    const note = screen.getByText(/We aim to acknowledge inside/);
    const stated = note.textContent?.match(/inside (\d+) hours/);
    expect(Number(stated?.[1])).toBe(documented);
  });
});
