/**
 * Unit tests for components/admin/features/engine-feedback-utils.ts, consumed
 * by promoted-rules-panel.tsx. The panel is a render component and this
 * project has no DOM-rendering test setup, so what is worth testing lives in a
 * plain .ts sibling (the same split as queue-status-utils.ts).
 *
 * The last block reads the panel's source: that the Remove control goes
 * through useConfirm is a property of how the file is wired, which a unit test
 * of the helpers cannot see.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  describeRuleMatch,
  describeRuleThreshold,
  removePromotedRule,
} from "@/components/admin/features/engine-feedback-utils";
import { API } from "@/lib/config/client-constants";

describe("describeRuleMatch", () => {
  it("lists CWEs on their own", () => {
    expect(
      describeRuleMatch({
        cwes: ["CWE-79", "CWE-89"],
        categories: [],
        requireBoth: false,
      }),
    ).toBe("CWE-79, CWE-89");
  });

  it("names categories as categories, singular or plural", () => {
    expect(
      describeRuleMatch({ cwes: [], categories: ["dns"], requireBoth: false }),
    ).toBe("category dns");
    expect(
      describeRuleMatch({
        cwes: [],
        categories: ["dns", "email"],
        requireBoth: false,
      }),
    ).toBe("categories dns, email");
  });

  it("joins the two lists with or by default and and when both are required", () => {
    const rule = { cwes: ["CWE-350"], categories: ["dns"] };
    expect(describeRuleMatch({ ...rule, requireBoth: false })).toBe(
      "CWE-350 or category dns",
    );
    expect(describeRuleMatch({ ...rule, requireBoth: true })).toBe(
      "CWE-350 and category dns",
    );
  });

  it("says so when a both-required rule has only one list, since it can never match", () => {
    const text = describeRuleMatch({
      cwes: ["CWE-79"],
      categories: [],
      requireBoth: true,
    });
    expect(text).toContain("never matches");
    expect(text).toContain("CWE-79");
  });

  it("does not claim a one-list rule is dead when either signal is enough", () => {
    expect(
      describeRuleMatch({
        cwes: ["CWE-79"],
        categories: [],
        requireBoth: false,
      }),
    ).not.toContain("never matches");
  });

  it("copes with an empty rule rather than printing nothing", () => {
    expect(
      describeRuleMatch({ cwes: [], categories: [], requireBoth: false }),
    ).toMatch(/empty/);
  });
});

describe("describeRuleThreshold", () => {
  it("reads as a floor and a count, with the count's noun agreeing", () => {
    expect(describeRuleThreshold({ minSeverity: "high", minCount: 2 })).toBe(
      "High or above, at least 2 matching findings",
    );
    expect(describeRuleThreshold({ minSeverity: "info", minCount: 1 })).toBe(
      "Info or above, at least 1 matching finding",
    );
  });

  it("prints a severity it does not know rather than undefined", () => {
    expect(describeRuleThreshold({ minSeverity: "weird", minCount: 1 })).toBe(
      "weird or above, at least 1 matching finding",
    );
  });
});

describe("removePromotedRule", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a DELETE for that rule id to the promoted-tags endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await removePromotedRule(17);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${API.ADMIN_PROMOTED_TAGS}?id=17`);
    expect(init.method).toBe("DELETE");
  });

  it("throws the server's message on a refusal, so the confirm dialog stays open and shows it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "No promoted rule with that id." }),
            {
              status: 404,
            },
          ),
      ),
    );

    await expect(removePromotedRule(17)).rejects.toThrow(
      "No promoted rule with that id.",
    );
  });

  it("throws a plain sentence when the failure has no JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>bad gateway</html>", { status: 502 }),
      ),
    );

    await expect(removePromotedRule(17)).rejects.toThrow(
      "Failed to remove the rule.",
    );
  });
});

describe("the Promoted rules panel", () => {
  const read = (file: string) =>
    readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "components",
        "admin",
        "features",
        file,
      ),
      "utf8",
    );
  const source = read("promoted-rules-panel.tsx");

  it("is rendered by the engine feedback manager", () => {
    expect(read("engine-feedback-manager.tsx")).toContain(
      "<PromotedRulesPanel",
    );
  });

  it("only ever removes a rule as a confirm request's onConfirm", () => {
    // removeRule is the panel's one path to the DELETE. Every use of it
    // other than its own definition must be the confirm's onConfirm, never an
    // onClick that fires it straight from the click.
    const uses = [...source.matchAll(/\bremoveRule\b/g)].filter(
      (m) => !source.slice(0, m.index).endsWith("const "),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(source.slice(0, use.index)).toMatch(/onConfirm: \(\) => $/);
    }
  });

  it("asks as a destructive action", () => {
    const start = source.indexOf("const askToRemoveRule");
    expect(start).toBeGreaterThan(-1);
    const ask = source.slice(start, source.indexOf("onConfirm:", start));
    expect(ask).toContain("confirm({");
    expect(ask).toContain("danger: true");
  });

  it("only calls the DELETE helper from removeRule", () => {
    const calls = [...source.matchAll(/\bremovePromotedRule\(/g)];
    expect(calls).toHaveLength(1);
    // The nearest declaration above the call is removeRule's own.
    const declarations = source
      .slice(0, calls[0].index)
      .match(/\bconst \w+ =/g);
    expect(declarations?.pop()).toBe("const removeRule =");
  });

  it("renders the confirm dialog", () => {
    expect(source).toContain("{confirmDialog}");
  });
});
