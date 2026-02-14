"use client"

import { useState } from "react"
import { Check, FileJson, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ScanResult } from "@/lib/scanner/types"
import { generatePdfReport } from "@/lib/pdf-report"
import { APP_VERSION, APP_SLUG, APP_NAME } from "@/lib/constants"


interface ExportButtonProps {
  result: ScanResult
}

export function ExportButton({ result }: ExportButtonProps) {
  const [exportedJson, setExportedJson] = useState(false)
  const [exportedPdf, setExportedPdf] = useState(false)

  const hostname = (() => {
    try { return new URL(result.url).hostname.replace(/\./g, "-") } catch { return "scan" }
  })()
  const date = new Date().toISOString().split("T")[0]

  function handleExportJson() {
    const exportData = {
      meta: {
        tool: APP_NAME,
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
      },
      scan: {
        url: result.url,
        scannedAt: result.scannedAt,
        duration: result.duration,
        summary: result.summary,
      },
      findings: result.findings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
        description: f.description,
        evidence: f.evidence,
        riskImpact: f.riskImpact,
        explanation: f.explanation,
        fixSteps: f.fixSteps,
        codeExamples: f.codeExamples,
      })),
    }

    const json = JSON.stringify(exportData, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    downloadBlob(blob, `${APP_SLUG}-${hostname}-${date}.json`)
    setExportedJson(true)
    setTimeout(() => setExportedJson(false), 2000)
  }

  function handleExportPdf() {
    const pdfBytes = generatePdfReport(result)
    const blob = new Blob([pdfBytes], { type: "application/pdf" })
    downloadBlob(blob, `${APP_SLUG}-${hostname}-${date}.pdf`)
    setExportedPdf(true)
    setTimeout(() => setExportedPdf(false), 2000)
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={handleExportJson} size="sm" className="gap-2 bg-transparent">
        {exportedJson ? (
          <>
            <Check className="h-4 w-4" />
            Exported
          </>
        ) : (
          <>
            <FileJson className="h-4 w-4" />
            Export JSON
          </>
        )}
      </Button>
      <Button variant="outline" onClick={handleExportPdf} size="sm" className="gap-2 bg-transparent">
        {exportedPdf ? (
          <>
            <Check className="h-4 w-4" />
            Exported
          </>
        ) : (
          <>
            <FileText className="h-4 w-4" />
            Export PDF
          </>
        )}
      </Button>
    </div>
  )
}
