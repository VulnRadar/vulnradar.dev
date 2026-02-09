import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const scanAId = request.nextUrl.searchParams.get("a")
  const scanBId = request.nextUrl.searchParams.get("b")

  if (!scanAId || !scanBId) {
    return NextResponse.json({ error: "Both scan IDs (a and b) are required" }, { status: 400 })
  }

  const result = await pool.query(
    `SELECT id, url, summary, findings, findings_count, duration, scanned_at, source
     FROM scan_history
     WHERE id IN ($1, $2) AND user_id = $3
     ORDER BY scanned_at ASC`,
    [scanAId, scanBId, session.userId],
  )

  if (result.rows.length !== 2) {
    return NextResponse.json({ error: "One or both scans not found" }, { status: 404 })
  }

  const [scanA, scanB] = result.rows

  // Compute diff: which findings are new, removed, or still present
  const rawA = typeof scanA.findings === "string" ? JSON.parse(scanA.findings) : scanA.findings
  const rawB = typeof scanB.findings === "string" ? JSON.parse(scanB.findings) : scanB.findings
  const findingsA: { title: string; severity: string }[] = (rawA || []).map((f: { title: string; severity: string }) => ({
    title: f.title,
    severity: f.severity,
  }))
  const findingsB: { title: string; severity: string }[] = (rawB || []).map((f: { title: string; severity: string }) => ({
    title: f.title,
    severity: f.severity,
  }))

  const titlesA = new Set(findingsA.map((f) => f.title))
  const titlesB = new Set(findingsB.map((f) => f.title))

  const added = findingsB.filter((f) => !titlesA.has(f.title))
  const removed = findingsA.filter((f) => !titlesB.has(f.title))
  const unchanged = findingsB.filter((f) => titlesA.has(f.title))

  return NextResponse.json({
    scanA: { id: scanA.id, url: scanA.url, summary: scanA.summary, findings_count: scanA.findings_count, scanned_at: scanA.scanned_at, source: scanA.source },
    scanB: { id: scanB.id, url: scanB.url, summary: scanB.summary, findings_count: scanB.findings_count, scanned_at: scanB.scanned_at, source: scanB.source },
    diff: {
      added,
      removed,
      unchanged,
      summary: {
        added: added.length,
        removed: removed.length,
        unchanged: unchanged.length,
      },
    },
  })
}
