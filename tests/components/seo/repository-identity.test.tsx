/**
 * Which GitHub repository is this site?
 *
 * Search engines answered with an unrelated project that happens to share the
 * name (github.com/RogoLabs/VulnRadar). The site already linked its own
 * repository, but only through the /github short link (a redirect) in the
 * footer, and the structured data never said what the repository is to the
 * product. These render the real components and read what a crawler reads.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OrganizationStructuredData,
  SoftwareStructuredData,
  SourceCodeStructuredData,
} from "@/components/seo/structured-data";
import { APP_REPO, APP_URL } from "@/lib/config/constants";

const REPO_URL = `https://github.com/${APP_REPO}`;
const ORG_URL = `https://github.com/${APP_REPO.split("/")[0]}`;

/** The JSON inside the one ld+json script a component renders. */
function jsonLd(element: React.ReactElement): Record<string, unknown> {
  const html = renderToStaticMarkup(element);
  const match = html.match(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
  );
  expect(match, html).not.toBeNull();
  return JSON.parse(match![1]);
}

describe("the site names its own repository", () => {
  it("lists the GitHub organisation and the repository as the organisation's profiles", () => {
    const org = jsonLd(<OrganizationStructuredData />);
    expect(org.sameAs).toEqual(expect.arrayContaining([ORG_URL, REPO_URL]));
  });

  it("says the repository is the source code of the product", () => {
    const source = jsonLd(<SourceCodeStructuredData />);
    const software = jsonLd(<SoftwareStructuredData />);
    expect(source["@type"]).toBe("SoftwareSourceCode");
    expect(source.codeRepository).toBe(REPO_URL);
    expect(software["@id"]).toBe(`${APP_URL}/#software`);
    expect(source.targetProduct).toEqual({ "@id": software["@id"] });
    expect(source.author).toEqual({ "@id": `${APP_URL}/#organization` });
  });

  it("emits the source code markup on the home page", () => {
    const landing = readFileSync(
      join(process.cwd(), "app/landing/page.tsx"),
      "utf8",
    );
    expect(landing).toContain("<SourceCodeStructuredData nonce={nonce} />");
    expect(readFileSync(join(process.cwd(), "app/page.tsx"), "utf8")).toContain(
      'from "./landing/page"',
    );
  });

  it("links the repository directly from the footer on every page", () => {
    const footer = readFileSync(
      join(process.cwd(), "components/scanner/footer.tsx"),
      "utf8",
    );
    // The footer's source text, so the placeholder is meant literally. The `$`
    // is split off so this stays a plain string instead of reading as a
    // template literal that forgot its backticks.
    expect(footer).toContain("href={`https://github.com/$" + "{APP_REPO}`}");
    expect(footer).not.toContain('href="/github"');
  });
});
