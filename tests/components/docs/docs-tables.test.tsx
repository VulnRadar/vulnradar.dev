import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DocsTable,
  EndpointTable,
  FieldTable,
  ParamTable,
} from "@/components/docs/docs-table";

describe("ParamTable on a phone", () => {
  const html = renderToStaticMarkup(
    <ParamTable
      params={[
        {
          name: "a_very_long_parameter_name",
          type: "string",
          description: "What it does.",
          required: true,
          default: "none-set",
        },
        { name: "plain", type: "number", description: "Second." },
      ]}
    />,
  );

  it("renders stacked blocks below sm and the table from sm", () => {
    expect(html).toContain("sm:hidden");
    expect(html).toMatch(/<dl[^>]*divide-y/);
    expect(html).toMatch(/class="[^"]*\bhidden\b[^"]*sm:block[^"]*"/);
    expect(html).toContain("<table");
  });

  it("shows name, type, required, default, then the description", () => {
    const stacked = html.slice(0, html.indexOf("<table"));
    const order = [
      "a_very_long_parameter_name",
      "string",
      "required",
      "Default: none-set",
      "What it does.",
    ].map((text) => stacked.indexOf(text));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("lets a long key wrap anywhere", () => {
    expect(html).toContain("wrap-anywhere");
  });

  it("omits the default line for a parameter without one", () => {
    expect(
      html.slice(0, html.indexOf("<table")).match(/Default:/g),
    ).toHaveLength(1);
  });
});

describe("FieldTable on a phone", () => {
  it("stacks field, type and description", () => {
    const html = renderToStaticMarkup(
      <FieldTable
        fields={[{ field: "scanId", type: "number", description: "The id." }]}
      />,
    );
    const stacked = html.slice(0, html.indexOf("<table"));
    expect(stacked).toContain("sm:hidden");
    expect(stacked).toContain("scanId");
    expect(stacked).toContain("The id.");
  });
});

describe("DocsTable on a phone", () => {
  const html = renderToStaticMarkup(
    <DocsTable
      columns={[
        { key: "setting", header: "Setting" },
        { key: "tier", header: "Tier" },
        { key: "type", header: "Type" },
        { key: "default", header: "Default" },
        { key: "description", header: "Description" },
      ]}
      data={[
        {
          setting: "CONFIG_X",
          tier: "Runtime",
          type: "number",
          default: "10",
          description: "How many.",
        },
      ]}
    />,
  );
  const stacked = html.slice(0, html.indexOf("<table"));

  it("gives every column a labelled row", () => {
    expect(stacked).toContain(">Default</dt>");
    expect(stacked).toContain(">Description</dt>");
  });

  it("folds Tier and Type into one mono line under the key", () => {
    expect(stacked).toContain("Runtime, number");
    expect(stacked).not.toContain(">Tier</dt>");
    expect(stacked).not.toContain(">Type</dt>");
    expect(stacked.indexOf("CONFIG_X")).toBeLessThan(
      stacked.indexOf("Runtime, number"),
    );
  });
});

describe("EndpointTable", () => {
  it("keeps its scroller at every width, having no stacked layout", () => {
    const html = renderToStaticMarkup(
      <EndpointTable
        endpoints={[{ endpoint: "/x", method: "GET", description: "d" }]}
      />,
    );
    expect(html).not.toMatch(/class="[^"]*\bhidden\b[^"]*overflow-x-auto/);
    expect(html).toContain("<table");
  });
});
