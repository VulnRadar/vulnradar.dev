import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { allCheckDefs } from "@/lib/scanner/registry";
import {
  ASYNC_CHECKS,
  getAsyncCheckDef,
} from "@/lib/scanner/async-check-catalog";
import { extractCheckId } from "@/lib/scanner/check-id";
import * as route from "@/app/api/v3/finding-types/route";

interface Row {
  id: string;
  type: string;
  title: string;
  category: string;
  severity: string;
  description: string;
  idPrefix?: string;
  emitted?: boolean;
  emittedAs?: string[];
}

function call() {
  return route.GET(
    new NextRequest("http://localhost/api/v3/finding-types", {
      method: "GET",
    }),
  );
}

async function rows(): Promise<Row[]> {
  return (await (await call()).json()).data;
}

describe("GET /api/v3/finding-types", () => {
  it("tells clients they may keep it for an hour", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, must-revalidate",
    );
  });

  it("answers the same body on every call", async () => {
    expect(await (await call()).text()).toBe(await (await call()).text());
  });

  it("lists every registered check and every async probe", async () => {
    const json = await (await call()).json();
    const asyncCount = Object.values(ASYNC_CHECKS).length;

    expect(json.success).toBe(true);
    expect(json.count).toBe(allCheckDefs.length + asyncCount);
    expect(json.data).toHaveLength(allCheckDefs.length + asyncCount);
  });

  it("keeps the six original keys on a row that is reported under its own id", async () => {
    const data = await rows();
    const headers = data.find((r) => r.id === "hsts-missing");

    expect(Object.keys(headers ?? {}).sort()).toEqual([
      "category",
      "description",
      "id",
      "severity",
      "title",
      "type",
    ]);
  });

  it("keeps the category counts equal to the rows listed under them", async () => {
    const json = await (await call()).json();
    const tally: Record<string, number> = {};
    for (const row of json.data as Row[]) {
      tally[row.category] = (tally[row.category] ?? 0) + 1;
    }
    for (const [category, count] of Object.entries(
      json.categories as Record<string, number>,
    )) {
      expect(tally[category] ?? 0, category).toBe(count);
    }
  });

  describe("async probes", () => {
    it("resolves every async check id to a row of type async-probe", async () => {
      const data = await rows();
      const byId = new Map(data.map((r) => [r.id, r]));

      for (const def of Object.values(ASYNC_CHECKS)) {
        const row = byId.get(def.checkId);
        expect(row, def.checkId).toBeDefined();
        expect(row?.type).toBe("async-probe");
        expect(row?.title).toBe(def.title);
        expect(row?.category).toBe(def.category);
        expect(row?.severity).toBe(def.severity);
        expect(row?.idPrefix).toBe(def.checkId);
      }
    });

    it("resolves the prefix of a real finding id back to its row", async () => {
      const data = await rows();
      const findingId = `${ASYNC_CHECKS.missingSpfRecord.checkId}--k3j9x1`;
      const row = data.find((r) => r.idPrefix === extractCheckId(findingId));

      expect(row?.title).toBe("Missing SPF Record");
      expect(getAsyncCheckDef(row?.idPrefix ?? "")).toBe(
        ASYNC_CHECKS.missingSpfRecord,
      );
    });

    it("never reuses a registry id", async () => {
      const data = await rows();
      const ids = data.map((r) => r.id);

      expect(new Set(ids).size).toBe(ids.length);
    });

    it("gives every async row a description", async () => {
      for (const row of (await rows()).filter(
        (r) => r.type === "async-probe",
      )) {
        expect(row.description.length, row.id).toBeGreaterThan(20);
      }
    });
  });

  describe("write-up entries", () => {
    it("marks an entry no scan reports under its own id, and names what it does report", async () => {
      const row = (await rows()).find((r) => r.id === "spf-record");

      expect(row?.emitted).toBe(false);
      expect(row?.emittedAs).toEqual(["async-missing-spf-record"]);
    });

    it("points every emittedAs at a row the same response lists", async () => {
      const data = await rows();
      const ids = new Set(data.map((r) => r.id));
      const marked = data.filter((r) => r.emitted === false);

      expect(marked.length).toBeGreaterThanOrEqual(47);
      for (const row of marked) {
        for (const asyncId of row.emittedAs ?? []) {
          expect(ids.has(asyncId), `${row.id} -> ${asyncId}`).toBe(true);
        }
      }
    });

    it("leaves emitted off every row a scan reports under its own id", async () => {
      const row = (await rows()).find(
        (r) => r.id === "dns-dnssec-algorithm-weak",
      );

      expect(row).toBeDefined();
      expect("emitted" in (row ?? {})).toBe(false);
    });
  });
});
