import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_TEMPLATES,
  campaignDefaults,
  getCampaignTemplate,
  releaseCampaignValues,
} from "@/lib/email/campaigns";
import { APP_NAME, APP_URL } from "@/lib/config/client-constants";

/**
 * The campaign templates: the messages a person writes rather than the ones
 * the product sends on its own.
 *
 * What these pin down is not the copy, which will change. It is the two
 * properties that make a marketing email safe to send from a product people
 * trust: every value a writer types is escaped before it reaches the markup,
 * and every template declares an audience that is one of the two preference
 * columns a recipient can actually switch off.
 */

describe("every campaign template", () => {
  it("declares an audience a recipient can switch off", () => {
    // Borrowing a security or billing category to reach people who opted out
    // of marketing is how a product loses the right to send either.
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(
        ["email_product_updates", "email_tips_guides"],
        `${t.id} must be gated on a marketing preference`,
      ).toContain(t.audience);
    }
  });

  it("has a unique id and at least one field", () => {
    const ids = CAMPAIGN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(t.fields.length, `${t.id} has no fields`).toBeGreaterThan(0);
      expect(new Set(t.fields.map((f) => f.key)).size).toBe(t.fields.length);
    }
  });

  it("renders a body and a subject from its own placeholders", () => {
    // The picker shows the placeholders as the starting draft, so a template
    // whose placeholders do not render is a template that opens broken.
    for (const t of CAMPAIGN_TEMPLATES) {
      const values = campaignDefaults(t);
      const body = t.body(values);
      expect(body.length, `${t.id} rendered nothing`).toBeGreaterThan(200);
      expect(t.subject(values).length).toBeGreaterThan(0);
      // Every one carries a way back to the product.
      expect(body).toContain("<a ");
    }
  });

  it("escapes what the writer typed", () => {
    // A broadcast reaches every registered account, and the composer's own
    // field is the untrusted input here: a stray angle bracket in a feature
    // name must not become markup, and a quote must not close an attribute.
    const hostile = `</td></table><script>alert(1)</script>"onmouseover="x`;
    for (const t of CAMPAIGN_TEMPLATES) {
      const values = Object.fromEntries(t.fields.map((f) => [f.key, hostile]));
      const body = t.body(values);
      expect(body, `${t.id} let a script tag through`).not.toContain(
        "<script>",
      );
      expect(body).not.toContain("</table><");
      expect(body).toContain("&lt;script&gt;");
    }
  });

  it("falls back to the placeholder rather than rendering an empty block", () => {
    for (const t of CAMPAIGN_TEMPLATES) {
      const blank = Object.fromEntries(t.fields.map((f) => [f.key, "   "]));
      const body = t.body(blank);
      const required = t.fields.find((f) => !f.multiline && !f.optional);
      if (!required) continue;
      // Whitespace is not a value. A heading rendered from one is an empty
      // heading, which reads as a broken email rather than as a draft.
      expect(body).toContain(required.placeholder.slice(0, 12));
    }
  });

  it("points every link at this deployment and at no other host", () => {
    // A self-hosted copy sends these too, so a hardcoded vulnradar.dev in a
    // template would send that deployment's users to somebody else's site.
    for (const t of CAMPAIGN_TEMPLATES) {
      const body = t.body(campaignDefaults(t));
      const hosts = [...body.matchAll(/href="(https?:\/\/[^\/"]+)/g)].map(
        (m) => m[1],
      );
      for (const host of hosts) {
        expect(host, `${t.id} links outside this deployment`).toBe(APP_URL);
      }
      expect(hosts.length, `${t.id} has no link home`).toBeGreaterThan(0);
    }
  });

  it("escapes a button label the writer chose", () => {
    // emailButton escapes the href, because every template that renders one
    // built it from APP_URL plus a server-generated token. It does not escape
    // the label, and two of these let a writer type one.
    for (const t of CAMPAIGN_TEMPLATES) {
      if (!t.fields.some((f) => f.key === "ctaLabel")) continue;
      const body = t.body({
        ...campaignDefaults(t),
        ctaLabel: "x</a><img src=x onerror=alert(1)>",
      });
      expect(body).not.toContain("<img src=x");
      expect(body).toContain("&lt;img");
    }
  });

  it("reduces a writer's button path to something that can only be a path", () => {
    for (const t of CAMPAIGN_TEMPLATES) {
      if (!t.fields.some((f) => f.key === "ctaPath")) continue;
      const body = t.body({
        ...campaignDefaults(t),
        ctaPath: 'dashboard" onclick="alert(1)',
      });
      // The quote and the space are gone, so what is left cannot close the
      // href and start an attribute: the junk ends up inside the path.
      const hrefs = [...body.matchAll(/href="([^"]*)"/g)]
        .map((m) => m[1])
        .filter((h) => h.startsWith("http"));
      for (const href of hrefs) {
        expect(href.includes(" ")).toBe(false);
        expect(href.startsWith(APP_URL)).toBe(true);
      }
      expect(body).not.toContain(` onclick=`);
    }
  });
});

describe("getCampaignTemplate", () => {
  it("finds a template by id and returns undefined for anything else", () => {
    expect(getCampaignTemplate("release-notes")?.name).toBe("Release notes");
    expect(getCampaignTemplate("no-such-template")).toBeUndefined();
  });
});

describe("release-notes", () => {
  it("names the app and the version in the subject", () => {
    const t = getCampaignTemplate("release-notes")!;
    const subject = t.subject({ version: "4.1.0", headline: "Faster scans" });
    expect(subject).toContain(APP_NAME);
    expect(subject).toContain("4.1.0");
    expect(subject).toContain("Faster scans");
  });

  it("turns one highlight per line into a list, dropping blank lines", () => {
    const t = getCampaignTemplate("release-notes")!;
    const body = t.body({
      version: "4.1.0",
      headline: "h",
      summary: "s",
      highlights: "First thing\n\n- Second thing\n   \n* Third thing",
    });
    expect(body).toContain("<li");
    expect(body).toContain("First thing");
    // The leading bullet a writer types is stripped rather than rendered
    // inside the bullet the list already draws.
    expect(body).toContain(">Second thing<");
    expect(body).toContain(">Third thing<");
    expect(body.match(/<li/g)).toHaveLength(3);
  });
});

describe("releaseCampaignValues", () => {
  const release = {
    version: "3.9.0",
    title: "Things that fail quietly",
    summary: "A sweep.",
    changes: [
      { label: "A fixed thing", category: "fixed" },
      { label: "A new thing", category: "added" },
      { label: "A security thing", category: "security" },
      { label: "A changed thing", category: "changed" },
      { label: "A fifth thing", category: "fixed" },
    ],
  };

  it("leads with what a reader most wants to know landed", () => {
    const values = releaseCampaignValues(release);
    const lines = values.highlights.split("\n");
    expect(lines[0]).toBe("A security thing");
    expect(lines[1]).toBe("A new thing");
  });

  it("stops at four, because a release email nobody finishes is not one", () => {
    expect(releaseCampaignValues(release).highlights.split("\n")).toHaveLength(
      4,
    );
  });

  it("carries the version, title and summary through unchanged", () => {
    const values = releaseCampaignValues(release);
    expect(values.version).toBe("3.9.0");
    expect(values.headline).toBe("Things that fail quietly");
    expect(values.summary).toBe("A sweep.");
  });

  it("survives a release whose entries carry no category", () => {
    const values = releaseCampaignValues({
      version: "1.0.0",
      title: "t",
      changes: [{ label: "Something" }],
    });
    expect(values.highlights).toBe("Something");
    expect(values.summary).toBe("");
  });
});
