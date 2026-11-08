import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Callout } from "@/components/shared/callout";

/**
 * The docs link rule, applied to the one aside in the product: underlined at
 * rest, because a callout's link was brand blue text in a muted box and the
 * only way to tell it was a link was to point at it.
 */
describe("Callout link classes", () => {
  const html = renderToStaticMarkup(
    <Callout variant="warning">
      See <a href="/docs/teams">the teams guide</a>.
    </Callout>,
  );

  it("renders the link", () => {
    expect(html).toContain('<a href="/docs/teams">the teams guide</a>');
  });

  it.each([
    "[&amp;_a]:text-[hsl(var(--primary-text))]",
    "[&amp;_a]:underline ",
    "[&amp;_a]:decoration-primary/40",
    "[&amp;_a]:underline-offset-2",
    "[&amp;_a:hover]:decoration-primary",
  ])("carries %s", (token) => {
    expect(html).toContain(token);
  });

  it("uses the AA link colour, which a text-primary variant does not get", () => {
    expect(html).not.toContain("[&amp;_a]:text-primary");
  });

  it("does not wait for hover to underline", () => {
    expect(html).not.toContain("[&amp;_a]:hover:underline");
  });
});
