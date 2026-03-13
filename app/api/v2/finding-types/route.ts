import { NextResponse } from "next/server"
import checksData from "@/lib/scanner/checks-data.json"

export async function GET() {
  try {
    // Extract all finding types (check IDs) from the checks data
    const findingTypes = checksData.checks.map((check: any) => ({
      id: check.id,
      type: check.type,
      title: check.title,
      category: check.category,
      severity: check.severity,
      description: check.description,
    }))

    return NextResponse.json({
      success: true,
      count: findingTypes.length,
      data: findingTypes,
    })
  } catch (error) {
    console.error("Error retrieving finding types:", error)
    return NextResponse.json(
      { success: false, error: "Failed to retrieve finding types" },
      { status: 500 }
    )
  }
}
