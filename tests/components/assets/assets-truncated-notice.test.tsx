import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetsTruncatedNotice } from "@/components/assets/assets-truncated-notice";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

describe("AssetsTruncatedNotice", () => {
  it("gives the caller's own list the real total", () => {
    const html = renderToStaticMarkup(
      <AssetsTruncatedNotice scope="mine" shown={100} totalHosts={143} />,
    );

    expect(text(html)).toContain(
      "Showing the 100 most recently scanned of your 143 hosts.",
    );
    expect(text(html)).toContain("Search only covers this list");
  });

  it("claims no total for the public list, which does not know one", () => {
    const html = renderToStaticMarkup(
      <AssetsTruncatedNotice scope="all" shown={500} totalHosts={500} />,
    );

    expect(text(html)).toContain(
      "Showing the 500 most recently scanned public hosts.",
    );
    expect(text(html)).not.toContain("500 hosts");
    expect(text(html)).not.toContain("of your");
  });

  it("is page content, not an announcement", () => {
    const html = renderToStaticMarkup(
      <AssetsTruncatedNotice scope="mine" shown={1} totalHosts={2} />,
    );

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });
});
