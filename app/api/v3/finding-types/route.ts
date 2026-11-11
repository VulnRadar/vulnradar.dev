import { NextResponse } from "next/server";
import { allCheckDefs, getCategoryCounts } from "@/lib/scanner/registry";
import { ASYNC_CHECKS } from "@/lib/scanner/async-check-catalog";
import { getCheckEmission } from "@/lib/scanner/check-emission";
import { versioned } from "@/lib/api/versioned";

interface FindingTypeRow {
  id: string;
  type: string;
  title: string;
  category: string;
  severity: string;
  description: string;
  /** Async probes only: every finding of this check has an id starting `<idPrefix>--`. */
  idPrefix?: string;
  /** Present, and false, on write-up entries no scan reports under their own id. */
  emitted?: false;
  /** The async check ids a scan reports for a write-up entry. */
  emittedAs?: readonly string[];
}

// The catalogue is compiled into the build and is the same for every caller,
// so it is serialised once rather than per request. It is a plain handler, not
// a force-static route, because the same handler answers /api/v3 and /api/v4.
let cachedBody: string | null = null;

function catalogueBody(): string {
  if (cachedBody) return cachedBody;

  const rows: FindingTypeRow[] = allCheckDefs.map((check) => {
    const emission = getCheckEmission(check.id);
    return {
      id: check.id,
      type: check.type,
      title: check.title,
      category: check.category,
      severity: check.severity,
      description: check.description,
      ...(emission.emitted
        ? {}
        : {
            emitted: false as const,
            ...(emission.emittedAs.length > 0
              ? { emittedAs: emission.emittedAs }
              : {}),
          }),
    };
  });

  // The async layer builds its findings in code, so none of its ids is in the
  // JSON registry above. Listing them here is what lets a client resolve an
  // `async-*` id from a scan to a title, category and severity.
  const categories: Record<string, number> = { ...getCategoryCounts() };
  for (const def of Object.values(ASYNC_CHECKS)) {
    rows.push({
      id: def.checkId,
      type: "async-probe",
      title: def.title,
      category: def.category,
      severity: def.severity,
      description: `Raised by a live probe while a scan runs, so it has no entry in the static catalogue. Finding ids for this check start with ${def.checkId}--.`,
      idPrefix: def.checkId,
    });
    categories[def.category] = (categories[def.category] || 0) + 1;
  }

  cachedBody = JSON.stringify({
    success: true,
    count: rows.length,
    categories,
    data: rows,
  });
  return cachedBody;
}

export const GET = versioned("findingTypes.list", async (_request: Request) => {
  return new NextResponse(catalogueBody(), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
});
