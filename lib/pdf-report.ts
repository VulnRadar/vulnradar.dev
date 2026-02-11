import type { ScanResult, Severity } from "./scanner/types"

// Lightweight PDF generation using raw PDF syntax -- no external dependencies needed
export function generatePdfReport(result: ScanResult): Uint8Array {
  const objects: { offset: number; content: string }[] = []
  let currentObj = 0

  function addObj(content: string) {
    currentObj++
    objects.push({ offset: 0, content: `${currentObj} 0 obj\n${content}\nendobj\n` })
    return currentObj
  }

  // Severity colors as RGB
  const SEVERITY_COLORS: Record<Severity, [number, number, number]> = {
    critical: [0.84, 0.15, 0.15],
    high: [0.95, 0.4, 0.1],
    medium: [0.85, 0.65, 0.1],
    low: [0.2, 0.5, 0.9],
    info: [0.5, 0.5, 0.55],
  }

  // Build page content
  const pageWidth = 595.28 // A4 width in points
  const pageHeight = 841.89 // A4 height in points
  const margin = 50
  const contentWidth = pageWidth - margin * 2
  let y = pageHeight - margin

  const streams: string[] = []

  function escPdf(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  }

  function addText(text: string, size: number, bold: boolean = false, color?: [number, number, number]) {
    if (y < margin + 40) {
      // Need new page logic -- for simplicity we'll just stop
      return
    }
    const font = bold ? "/F2" : "/F1"
    let cmd = ""
    if (color) {
      cmd += `${color[0].toFixed(2)} ${color[1].toFixed(2)} ${color[2].toFixed(2)} rg\n`
    } else {
      cmd += "0.1 0.1 0.12 rg\n"
    }
    // Wrap text
    const maxCharsPerLine = Math.floor(contentWidth / (size * 0.5))
    const wrappedLines = wrapText(text, maxCharsPerLine)
    for (const line of wrappedLines) {
      if (y < margin + 20) return
      cmd += `BT ${font} ${size} Tf ${margin} ${y.toFixed(2)} Td (${escPdf(line)}) Tj ET\n`
      y -= size * 1.4
    }
    streams.push(cmd)
  }

  function addLine() {
    if (y < margin + 20) return
    streams.push(
        `0.85 0.85 0.87 RG\n0.5 w\n${margin} ${y.toFixed(2)} m ${pageWidth - margin} ${y.toFixed(2)} l S\n`
    )
    y -= 10
  }

  function addSpacer(h: number) {
    y -= h
  }

  function wrapText(text: string, maxChars: number): string[] {
    const result: string[] = []
    const words = text.split(" ")
    let current = ""
    for (const word of words) {
      if ((current + " " + word).trim().length > maxChars) {
        if (current) result.push(current.trim())
        current = word
      } else {
        current = current ? current + " " + word : word
      }
    }
    if (current) result.push(current.trim())
    return result
  }

  // Title section
  addText("VULNRADAR SECURITY REPORT", 18, true, [0.1, 0.7, 0.8])
  addSpacer(8)
  addLine()
  addSpacer(6)

  // Meta info
  addText(`Target: ${result.url}`, 10, false)
  addText(`Scanned: ${new Date(result.scannedAt).toLocaleString()}`, 10, false)
  addText(`Duration: ${(result.duration / 1000).toFixed(1)}s`, 10, false)
  addText(`Total Findings: ${result.findings.length}`, 10, true)
  addSpacer(10)

  // Safety Rating - smart categorization by threat type
  const criticalExploitable = ["Unencrypted HTTP", "SQL Injection", "Command Injection", "Dangerous CORS", "Credentials in URL", "Exposed API Keys", "Exposed Error Messages"]
  const highActiveVulns = ["XXE Vulnerability", "SSRF Vulnerability", "Path Traversal", "Insecure Deserialization", "Prototype Pollution", "XSS Patterns", "SQL Error", "eval() Usage"]
  const highConfigIssues = ["Missing HSTS", "Missing CSP", "Weak Crypto", "Open Redirect", "Clickjacking", "Mixed Content"]
  const informationalOnly = ["Framework-Required", "Server Technology", "DNS Prefetch", "Cookie without HttpOnly", "Missing security.txt"]

  const criticalThreats = result.findings.filter((f) => (f.severity === "critical" || f.severity === "high") && !informationalOnly.some(p => f.title.includes(p)) && criticalExploitable.some(p => f.title.includes(p)))
  const activeVulns = result.findings.filter((f) => f.severity === "high" && !informationalOnly.some(p => f.title.includes(p)) && highActiveVulns.some(p => f.title.includes(p)))
  const configIssues = result.findings.filter((f) => (f.severity === "high" || f.severity === "medium") && !informationalOnly.some(p => f.title.includes(p)) && highConfigIssues.some(p => f.title.includes(p)))
  const otherMediumIssues = result.findings.filter((f) => f.severity === "medium" && !informationalOnly.some(p => f.title.includes(p)) && !highConfigIssues.some(p => f.title.includes(p)))

  const safetyRating =
      criticalThreats.length > 0 || activeVulns.length >= 2
          ? { label: "NOT SAFE TO VIEW", color: [0.8, 0.2, 0.2] as [number, number, number], desc: "Critical exploitable vulnerabilities detected" }
          : (configIssues.length >= 3 || (activeVulns.length === 1 && configIssues.length >= 2) || activeVulns.length === 1 || configIssues.length >= 1 || otherMediumIssues.length >= 4)
              ? { label: "VIEW WITH CAUTION", color: [0.85, 0.65, 0.1] as [number, number, number], desc: "Security issues require attention" }
              : { label: "SAFE TO VIEW", color: [0.1, 0.65, 0.3] as [number, number, number], desc: "No critical security issues detected" }

  addText("SAFETY RATING", 12, true, [0.1, 0.7, 0.8])
  addSpacer(4)
  addText(safetyRating.label, 11, true, safetyRating.color)
  addText(safetyRating.desc, 9, false, [0.4, 0.4, 0.45])
  addSpacer(10)
  addLine()
  addSpacer(8)

  // Summary
  addText("SEVERITY SUMMARY", 12, true, [0.1, 0.7, 0.8])
  addSpacer(4)
  const severities: Severity[] = ["critical", "high", "medium", "low", "info"]
  for (const sev of severities) {
    const count = result.summary[sev]
    if (count > 0) {
      addText(`  ${sev.toUpperCase()}: ${count}`, 10, true, SEVERITY_COLORS[sev])
    }
  }
  addSpacer(10)
  addLine()
  addSpacer(8)

  // Findings
  if (result.findings.length > 0) {
    addText("FINDINGS", 14, true, [0.1, 0.7, 0.8])
    addSpacer(8)

    for (let i = 0; i < result.findings.length; i++) {
      const f = result.findings[i]
      if (y < margin + 100) break // Stop if running out of page

      addText(`${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`, 11, true, SEVERITY_COLORS[f.severity])
      addSpacer(2)
      addText(f.description, 9, false)
      addSpacer(2)
      addText(`Evidence: ${f.evidence}`, 8, false, [0.4, 0.4, 0.45])
      addSpacer(2)
      addText(`Risk: ${f.riskImpact}`, 8, false, [0.4, 0.4, 0.45])
      addSpacer(2)
      if (f.fixSteps.length > 0) {
        addText("Fix:", 8, true)
        for (const step of f.fixSteps.slice(0, 3)) {
          addText(`  - ${step}`, 8, false)
        }
      }
      addSpacer(8)
      addLine()
      addSpacer(6)
    }
  } else {
    addText("No vulnerabilities were detected.", 11, false, [0.2, 0.7, 0.3])
  }

  // Footer
  addSpacer(10)
  addText("Generated by VulnRadar. For authorized security testing only.", 8, false, [0.5, 0.5, 0.55])

  // Build the stream
  const stream = streams.join("\n")

  // Create PDF structure
  // 1: Catalog
  const catalogObj = addObj("<< /Type /Catalog /Pages 2 0 R >>")
  // 2: Pages
  addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
  // 3: Page
  addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`
  )
  // 4: Content stream
  const streamBytes = new TextEncoder().encode(stream)
  addObj(`<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`)
  // 5: Font (Helvetica)
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  // 6: Font Bold
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

  // Assemble PDF
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(pdf.length)
    pdf += obj.content
  }

  const xrefOffset = pdf.length
  pdf += "xref\n"
  pdf += `0 ${objects.length + 1}\n`
  pdf += "0000000000 65535 f \n"
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  }
  pdf += "trailer\n"
  pdf += `<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\n`
  pdf += "startxref\n"
  pdf += `${xrefOffset}\n`
  pdf += "%%EOF"

  return new TextEncoder().encode(pdf)
}