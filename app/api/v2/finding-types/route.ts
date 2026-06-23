import { NextResponse } from "next/server";
import { allCheckDefs, getCategoryCounts } from "@/lib/scanner/registry";

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

    return NextResponse.json({
      success: true,
      count: findingTypes.length,
      categories: getCategoryCounts(),
      data: findingTypes,
    });
  } catch (error) {
    console.error("Error retrieving finding types:", error);
    return NextResponse.json(
      { success: false, error: "Failed to retrieve finding types" },
      { status: 500 },
    );
  }
}
