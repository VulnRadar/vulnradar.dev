/**
 * Two webhook endpoints existed, were documented, and had no way to reach them
 * without curl: POST /webhooks/{id}/rotate-secret and GET
 * /webhooks/{id}/deliveries. That is the gap this project keeps finding, most
 * memorably when share links could be given a custom lifetime over the API and
 * the UI offered one fixed duration.
 *
 * Source-text assertions, because this Vitest config runs plain node with no
 * jsdom and a `.tsx` cannot be rendered. What matters here is the wiring: that
 * the buttons exist, call the right endpoints, name themselves for a screen
 * reader, and route the destructive one through the shared confirmation.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SHELL = read("components/profile/tabs/profile-developer-tab.tsx");
const SECTION = read("components/profile/tabs/developer/webhooks-section.tsx");
const TYPES = read("components/profile/tabs/developer/types.ts");

describe("every webhook endpoint is reachable from the UI", () => {
  it("rotates the signing secret", () => {
    expect(SHELL).toContain("/rotate-secret");
    expect(SHELL).toContain('method: "POST"');
    expect(SECTION).toMatch(/aria-label=\{`Rotate the signing secret for/);
  });

  it("puts the rotate behind the shared confirmation, not a bare click", () => {
    // Every receiver verifying signatures starts rejecting deliveries the
    // instant this lands, and there is no undo.
    expect(TYPES).toContain('kind: "rotate-webhook-secret"');
    expect(SHELL).toContain('case "rotate-webhook-secret":');
    expect(SHELL).toContain("destructive: true");
    expect(SECTION).toContain("onRotateWebhookSecret(wh)");
  });

  it("shows the new secret in the same once-only panel as a new webhook", () => {
    // The column stores ciphertext and nothing reads it back, so a secret not
    // captured here is gone. It must not be parked in the webhooks list.
    const rotate = SHELL.slice(
      SHELL.indexOf("async function handleRotateWebhookSecret"),
    ).slice(0, 1200);
    expect(rotate).toContain("setNewlyCreatedWebhookSecret(data.secret");
    expect(rotate).not.toContain("setWebhooks(");
  });

  it("lists recent deliveries", () => {
    expect(SHELL).toContain("/deliveries");
    expect(SECTION).toMatch(/recent deliveries for/);
    expect(SECTION).toContain("aria-expanded={showingDeliveries}");
  });

  it("loads the delivery log on demand rather than with the page", () => {
    // Up to 50 rows per webhook, and most visits to this tab are not about
    // debugging one.
    expect(SHELL).toContain("async function handleToggleDeliveries");
    expect(SHELL).toContain("setLoadingDeliveries(true)");
  });

  it("tells a missing response apart from a failing one", () => {
    // http_status is null when the request never got a response at all, which
    // is a different problem from "the endpoint returned 500".
    expect(SECTION).toContain("function deliveryTone");
    expect(SECTION).toContain('label: "No response"');
  });

  it("keeps a long delivery log from scrolling the page sideways", () => {
    const panel = SECTION.slice(SECTION.indexOf("showingDeliveries && ("));
    expect(panel).toContain("overflow-x-auto");
  });

  it("says in the docs that the UI can do both", () => {
    // The webhooks doc used to send people to the API reference for these two
    // because that was the only place they existed.
    const docs = read("app/docs/webhooks/page.tsx");
    expect(docs).toContain("dtab=webhooks");
    expect(docs).toMatch(/rotate and history buttons/);
  });
});
