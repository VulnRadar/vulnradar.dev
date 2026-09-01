import { describe, it, expect } from "vitest";
import {
  ACTIVE_PROBE_IDS,
  ACTIVE_PROBE_LIMITS_NOTE,
  ACTIVE_PROBE_OPTIONS,
  ACTIVE_PROBES_CATEGORY,
  activeProbeScanner,
  isActiveProbeSelector,
  requestsActiveProbing,
  resolveSelectedActiveProbes,
  parseActiveProbeIds,
  serializeActiveProbeIds,
} from "@/lib/scanner/active-probe-catalog";

describe("active-probe catalog", () => {
  it("has nine probes, each with a label and a non-empty, em-dash-free description", () => {
    expect(ACTIVE_PROBE_OPTIONS).toHaveLength(9);
    expect(ACTIVE_PROBE_IDS).toHaveLength(9);
    for (const opt of ACTIVE_PROBE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.description.length).toBeGreaterThan(0);
      // House rule: no em dashes in user-facing copy.
      expect(opt.description).not.toContain("—");
    }
  });

  it("has unique ids that never collide with the umbrella category", () => {
    const ids = new Set<string>(ACTIVE_PROBE_IDS);
    expect(ids.size).toBe(ACTIVE_PROBE_IDS.length);
    expect(ids.has(ACTIVE_PROBES_CATEGORY)).toBe(false);
  });

  describe("activeProbeScanner / isActiveProbeSelector", () => {
    it("encodes each probe as active-probes:<id> and recognizes it", () => {
      for (const id of ACTIVE_PROBE_IDS) {
        const selector = activeProbeScanner(id);
        expect(selector).toBe(`active-probes:${id}`);
        expect(isActiveProbeSelector(selector)).toBe(true);
      }
    });

    it("recognizes the legacy bare umbrella selector", () => {
      expect(isActiveProbeSelector("active-probes")).toBe(true);
    });

    it("does not treat a real category or an unknown suffix as a selector", () => {
      expect(isActiveProbeSelector("headers")).toBe(false);
      expect(isActiveProbeSelector("active-probes:nope")).toBe(false);
    });
  });

  describe("resolveSelectedActiveProbes", () => {
    it("returns exactly the one probe named, not the other eight", () => {
      expect(resolveSelectedActiveProbes(["active-probes:xss"])).toEqual([
        "xss",
      ]);
      expect(resolveSelectedActiveProbes(["active-probes:sqli"])).toEqual([
        "sqli",
      ]);
    });

    it("returns a subset in canonical order regardless of input order", () => {
      expect(
        resolveSelectedActiveProbes([
          "active-probes:ssti",
          "active-probes:xss",
        ]),
      ).toEqual(["xss", "ssti"]);
    });

    it("expands the legacy bare active-probes selector to all nine (back-compat)", () => {
      expect(resolveSelectedActiveProbes(["active-probes"])).toEqual([
        ...ACTIVE_PROBE_IDS,
      ]);
    });

    it("legacy bare selector wins even if mixed with per-probe selectors", () => {
      expect(
        resolveSelectedActiveProbes(["active-probes", "active-probes:xss"]),
      ).toEqual([...ACTIVE_PROBE_IDS]);
    });

    it("ignores ordinary categories and returns nothing when none are active", () => {
      expect(resolveSelectedActiveProbes(["headers", "ssl"])).toEqual([]);
      expect(resolveSelectedActiveProbes(null)).toEqual([]);
      expect(resolveSelectedActiveProbes([])).toEqual([]);
    });
  });

  describe("requestsActiveProbing", () => {
    it("is true for a single per-probe selector, the umbrella, or a mix", () => {
      expect(requestsActiveProbing(["headers", "active-probes:cors"])).toBe(
        true,
      );
      expect(requestsActiveProbing(["active-probes"])).toBe(true);
    });

    it("is false for ordinary categories, empty, or null", () => {
      expect(requestsActiveProbing(["headers", "ssl", "dns"])).toBe(false);
      expect(requestsActiveProbing([])).toBe(false);
      expect(requestsActiveProbing(null)).toBe(false);
    });
  });

  // ref: AUDIT-014#comp-11. Every probe decides from the immediate response,
  // so blind, time-based and out-of-band flaws are undetectable here by
  // construction. The note exists so the surfaces that render the probe list
  // state that ceiling instead of leaving a reader to assume ZAP-equivalent
  // coverage.
  it("states the detection ceiling in one em-dash-free sentence", () => {
    expect(ACTIVE_PROBE_LIMITS_NOTE.length).toBeGreaterThan(0);
    expect(ACTIVE_PROBE_LIMITS_NOTE).not.toContain("—");
    expect(ACTIVE_PROBE_LIMITS_NOTE).toMatch(/blind/i);
    expect(ACTIVE_PROBE_LIMITS_NOTE).toMatch(/out-of-band/i);
  });

  describe("parse / serialize URL param", () => {
    it("round-trips a selection through the active_probes param", () => {
      const serialized = serializeActiveProbeIds(["xss", "graphql"]);
      expect(serialized).toBe("xss,graphql");
      expect(parseActiveProbeIds(serialized)).toEqual(["xss", "graphql"]);
    });

    it("drops unknown ids and returns null for an empty selection", () => {
      expect(parseActiveProbeIds("xss,bogus,cors")).toEqual(["xss", "cors"]);
      expect(serializeActiveProbeIds([])).toBeNull();
      expect(parseActiveProbeIds(null)).toEqual([]);
    });
  });
});
