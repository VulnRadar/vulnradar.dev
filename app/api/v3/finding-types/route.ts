import { NextResponse } from "next/server";
import { allCheckDefs, getCategoryCounts } from "@/lib/scanner/registry";

// The catalogue is compiled into the build and is the same for every caller,
// so it is rendered once rather than re-serialised per request.
export const dynamic = "force-static";

export async function GET() {
  try {
    const findingTypes = allCheckDefs.map((check) => ({
      id: check.id,
      type: check.type,
      title: check.title,
      category: check.category,
      severity: check.severity,
      description: check.description,
    }));

    return NextResponse.json(
      {
        success: true,
        count: findingTypes.length,
        categories: getCategoryCounts(),
        data: findingTypes,
      },
      { headers: { "Cache-Control": "public, max-age=3600, must-revalidate" } },
    );
  } catch (error) {
    console.error("Error retrieving finding types:", error);
    return NextResponse.json(
      { success: false, error: "Failed to retrieve finding types" },
      { status: 500 },
    );
  }
}
