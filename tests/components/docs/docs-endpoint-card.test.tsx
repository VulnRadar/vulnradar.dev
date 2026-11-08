import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { EndpointCard } from "@/components/docs/docs-endpoint-card";
import type { Endpoint } from "@/components/docs/docs-types";

const base: Endpoint = {
  id: "post-keys",
  method: "POST",
  path: "/keys",
  title: "Create a key",
  description: "Makes one.",
  responseExample: '{"id": 1}',
};

const render = (extra: Partial<Endpoint> = {}) =>
  renderToStaticMarkup(<EndpointCard {...base} {...extra} />);

describe("EndpointCard", () => {
  it("defaults to 200 OK", () => {
    expect(render()).toContain("200 OK");
  });

  it.each([
    [201, "201 Created"],
    [202, "202 Accepted"],
  ])("renders %i with its reason phrase", (status, text) => {
    const html = render({ successStatus: status });
    expect(html).toContain(text);
    expect(html).not.toContain("200 OK");
  });

  it("is a top-level panel", () => {
    expect(render()).toContain("rounded-xl border border-border bg-card");
  });

  it("lands below the sticky bar, not 160px down", () => {
    const html = render();
    expect(html).toContain("scroll-mt-4");
    expect(html).not.toContain("scroll-mt-24");
  });

  it("lists bodyParams under Request body", () => {
    const html = render({
      bodyParams: [{ name: "label", type: "string", description: "Name." }],
    });
    expect(html).toContain("Request body</h4>");
    expect(html).toContain("label");
  });

  it("prints the auth line", () => {
    expect(render({ auth: "Session only" })).toContain("Auth: Session only");
  });

  it("deep links Try it to the playground operation", () => {
    expect(render({ tryIt: "createKey" })).toContain(
      'href="/docs/api/playground?op=createKey"',
    );
    expect(render()).not.toContain("Try it");
  });

  it("puts request and response in tabs, both in the HTML", () => {
    const html = render({ requestBody: '{"name": "ci"}', successStatus: 201 });
    expect(html).toMatch(/role="tablist"/);
    expect(html).toContain("Response 201");
    expect(html).toContain("{&quot;name&quot;: &quot;ci&quot;}");
    expect(html).toContain("{&quot;id&quot;: 1}");
  });

  it("skips the tabs when there is no request to show", () => {
    const html = render();
    expect(html).not.toMatch(/role="tablist"/);
    expect(html).toContain("Response</h4>");
  });

  it("says so when a response has no body", () => {
    expect(render({ responseExample: "", successStatus: 204 })).toContain(
      "204 No Content, with no body.",
    );
  });

  describe("notes", () => {
    it("still accepts the old plain strings, in a plain list", () => {
      const html = render({ notes: ["Old style note"] });
      expect(html).toContain('<ul class="list-disc');
      expect(html).toContain("Old style note");
    });

    it("draws no check icons", () => {
      expect(render({ notes: ["x"] })).not.toContain("lucide-circle-check");
    });

    it("routes warnings to a callout", () => {
      const html = render({
        notes: [{ tone: "warning", body: "Shown once." }],
      });
      expect(html).toContain("<aside");
      expect(html).toContain("Shown once.");
      expect(html).not.toContain('<ul class="list-disc');
    });

    it("takes a ReactNode body", () => {
      const html = render({
        notes: [{ tone: "info", body: <a href="/x">A link</a> }],
      });
      expect(html).toContain('<a href="/x">A link</a>');
    });

    it("stops at five", () => {
      const html = render({
        notes: ["1", "2", "3", "4", "5", "the sixth"].map((body) => ({
          tone: "info" as const,
          body,
        })),
      });
      expect(html).toContain(">5</li>");
      expect(html).not.toContain("the sixth");
    });

    it("does not cap the old strings, which would delete live reference text", () => {
      const html = render({
        notes: ["1", "2", "3", "4", "5", "the sixth"],
      });
      expect(html).toContain("the sixth");
    });
  });
});
