import type { ScanResult, Severity } from "./scanner/types"
import { APP_NAME } from "./constants"
import { SEVERITY_LEVELS } from "@/lib/constants"

// Lightweight multi-page PDF generation using raw PDF syntax -- no external deps
export function generatePdfReport(result: ScanResult): Uint8Array {
  const pageWidth = 595.28 // A4 width in points
  const pageHeight = 841.89 // A4 height in points
  const margin = 50
  const contentWidth = pageWidth - margin * 2
  const bottomMargin = margin + 30 // leave room for footer

  // Severity colors as RGB
  const SEVERITY_COLORS: Record<Severity, [number, number, number]> = {
    critical: [0.84, 0.15, 0.15],
    high: [0.95, 0.4, 0.1],
    medium: [0.85, 0.65, 0.1],
    low: [0.2, 0.5, 0.9],
    info: [0.5, 0.5, 0.55],
  }

  // Collect pages as arrays of stream commands
  const pages: string[][] = []
  let currentPageStreams: string[] = []
  let y = pageHeight - margin

  function startNewPage() {
    if (currentPageStreams.length > 0) {
      pages.push(currentPageStreams)
    }
    currentPageStreams = []
    y = pageHeight - margin
  }

  function ensureSpace(needed: number) {
    if (y - needed < bottomMargin) {
      startNewPage()
    }
  }

  function escPdf(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  }

  function wrapText(text: string, maxChars: number): string[] {
    const lines: string[] = []
    const words = text.split(" ")
    let current = ""
    for (const word of words) {
      if ((current + " " + word).trim().length > maxChars) {
        if (current) lines.push(current.trim())
        current = word
      } else {
        current = current ? current + " " + word : word
      }
    }
    if (current) lines.push(current.trim())
    return lines.length > 0 ? lines : [""]
  }

  function addText(text: string, size: number, bold: boolean = false, color?: [number, number, number]) {
    const font = bold ? "/F2" : "/F1"
    const maxCharsPerLine = Math.floor(contentWidth / (size * 0.5))
    const wrappedLines = wrapText(text, maxCharsPerLine)
    const lineHeight = size * 1.4

    for (const line of wrappedLines) {
      ensureSpace(lineHeight)
      let cmd = ""
      if (color) {
        cmd += `${color[0].toFixed(2)} ${color[1].toFixed(2)} ${color[2].toFixed(2)} rg\n`
      } else {
        cmd += "0.1 0.1 0.12 rg\n"
      }
      cmd += `BT ${font} ${size} Tf ${margin} ${y.toFixed(2)} Td (${escPdf(line)}) Tj ET\n`
      currentPageStreams.push(cmd)
      y -= lineHeight
    }
  }

  function addLine() {
    ensureSpace(12)
    currentPageStreams.push(
      `0.85 0.85 0.87 RG\n0.5 w\n${margin} ${y.toFixed(2)} m ${pageWidth - margin} ${y.toFixed(2)} l S\n`
    )
    y -= 10
  }

  function addSpacer(h: number) {
    // Don't force a new page for spacers, just reduce y.
    // If we're already near the bottom, the next addText/addLine will handle it.
    y -= h
  }

  // ---- Build the content ----

  // Title section
  addText(`${APP_NAME.toUpperCase()} SECURITY REPORT`, 18, true, [0.1, 0.7, 0.8])
  addSpacer(8)
  addLine()
  addSpacer(6)

  // Meta info
  addText(`Target: ${result.url}`, 10, false)
  addText(`Scanned: ${new Date(result.scannedAt).toLocaleString()}`, 10, false)
  addText(`Duration: ${(result.duration / 1000).toFixed(1)}s`, 10, false)
  addText(`Total Findings: ${result.findings.length}`, 10, true)
  addSpacer(10)

  // Safety Rating
  const criticalExploitable = ["Unencrypted HTTP", "SQL Injection", "Command Injection", "Dangerous CORS", "Credentials in URL", "Exposed API Keys", "Exposed Error Messages"]
  const highActiveVulns = ["XXE Vulnerability", "SSRF Vulnerability", "Path Traversal", "Insecure Deserialization", "Prototype Pollution", "XSS Patterns", "SQL Error", "eval() Usage"]
  const highConfigIssues = ["Missing HSTS", "Missing CSP", "Weak Crypto", "Open Redirect", "Clickjacking", "Mixed Content"]
  const informationalOnly = ["Framework-Required", "Server Technology", "DNS Prefetch", "Cookie without HttpOnly", "Missing security.txt"]

  const criticalThreats = result.findings.filter((f) => (f.severity === SEVERITY_LEVELS.CRITICAL || f.severity === SEVERITY_LEVELS.HIGH) && !informationalOnly.some(p => f.title.includes(p)) && criticalExploitable.some(p => f.title.includes(p)))
  const activeVulns = result.findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH && !informationalOnly.some(p => f.title.includes(p)) && highActiveVulns.some(p => f.title.includes(p)))
  const configIssues = result.findings.filter((f) => (f.severity === SEVERITY_LEVELS.HIGH || f.severity === SEVERITY_LEVELS.MEDIUM) && !informationalOnly.some(p => f.title.includes(p)) && highConfigIssues.some(p => f.title.includes(p)))
  const otherMediumIssues = result.findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM && !informationalOnly.some(p => f.title.includes(p)) && !highConfigIssues.some(p => f.title.includes(p)))

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
  const severities: Severity[] = [
    SEVERITY_LEVELS.CRITICAL,
    SEVERITY_LEVELS.HIGH,
    SEVERITY_LEVELS.MEDIUM,
    SEVERITY_LEVELS.LOW,
    SEVERITY_LEVELS.INFO
  ] as Severity[]
  for (const sev of severities) {
    const count = result.summary[sev]
    if (count > 0) {
      addText(`  ${sev.toUpperCase()}: ${count}`, 10, true, SEVERITY_COLORS[sev])
    }
  }
  addSpacer(10)
  addLine()
  addSpacer(8)

  // Findings -- all of them, across as many pages as needed
  if (result.findings.length > 0) {
    addText("FINDINGS", 14, true, [0.1, 0.7, 0.8])
    addSpacer(8)

    for (let i = 0; i < result.findings.length; i++) {
      const f = result.findings[i]

      // Estimate height needed for this finding's header (title + desc + evidence + risk)
      // If it won't fit, start a new page so we don't orphan a heading
      ensureSpace(80)

      addText(`${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`, 11, true, SEVERITY_COLORS[f.severity])
      addSpacer(2)
      addText(f.description, 9, false)
      addSpacer(2)
      addText(`Evidence: ${f.evidence}`, 8, false, [0.4, 0.4, 0.45])
      addSpacer(2)
      addText(`Risk: ${f.riskImpact}`, 8, false, [0.4, 0.4, 0.45])
      addSpacer(2)

      // Explanation
      if (f.explanation) {
        addText(`Explanation: ${f.explanation}`, 8, false, [0.3, 0.3, 0.35])
        addSpacer(2)
      }

      // Fix steps -- all of them
      if (f.fixSteps.length > 0) {
        addText("Fix Steps:", 8, true)
        for (const step of f.fixSteps) {
          addText(`  - ${step}`, 8, false)
        }
        addSpacer(2)
      }

      // Code examples
      if (f.codeExamples && f.codeExamples.length > 0) {
        addText("Code Examples:", 8, true)
        for (const example of f.codeExamples) {
          if (example.label) {
            addText(`  ${example.label}:`, 8, true, [0.3, 0.3, 0.35])
          }
          // Render code lines (split by newlines for readability)
          const codeLines = example.code.split("\n")
          for (const codeLine of codeLines) {
            addText(`    ${codeLine}`, 7, false, [0.35, 0.35, 0.4])
          }
          addSpacer(2)
        }
      }

      addSpacer(6)
      addLine()
      addSpacer(6)
    }
  } else {
    addText("No vulnerabilities were detected.", 11, false, [0.2, 0.7, 0.3])
  }

  // Footer note
  addSpacer(10)
  addText(`Generated by ${APP_NAME}. For authorized security testing only.`, 8, false, [0.5, 0.5, 0.55])

  // Push the last page
  if (currentPageStreams.length > 0) {
    pages.push(currentPageStreams)
  }

  // ---- Assemble multi-page PDF ----
  const objects: { content: string }[] = []
  let currentObjNum = 0

  function addObj(content: string) {
    currentObjNum++
    objects.push({ content: `${currentObjNum} 0 obj\n${content}\nendobj\n` })
    return currentObjNum
  }

  // Font objects first (shared across all pages)
  const fontRegular = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  const fontBold = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

  // Resources dictionary (shared)
  const resourcesDict = `<< /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >>`

  // Build content stream objects for each page
  const streamObjIds: number[] = []
  for (const pageStreams of pages) {
    const stream = pageStreams.join("\n")
    const streamBytes = new TextEncoder().encode(stream)
    const objId = addObj(`<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`)
    streamObjIds.push(objId)
  }

  // Build page objects
  const pageObjIds: number[] = []
  const pagesObjNum = currentObjNum + 1 + pages.length // will be set after page objects
  for (let i = 0; i < pages.length; i++) {
    // Add page footer with page number
    const footerStream = `0.5 0.5 0.55 rg\nBT /F1 7 Tf ${pageWidth / 2 - 20} 25 Td (Page ${i + 1} of ${pages.length}) Tj ET\n`
    const footerBytes = new TextEncoder().encode(footerStream)
    const footerObjId = addObj(`<< /Length ${footerBytes.length} >>\nstream\n${footerStream}\nendstream`)

    const pageId = addObj(
      `<< /Type /Page /Parent ${currentObjNum + pages.length - i} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents [${streamObjIds[i]} 0 R ${footerObjId} 0 R] /Resources ${resourcesDict} >>`
    )
    pageObjIds.push(pageId)
  }

  // Pages object
  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ")
  const pagesObj = addObj(`<< /Type /Pages /Kids [${kidsStr}] /Count ${pages.length} >>`)

  // Fix parent reference -- we need to re-assign parent. Since raw PDF, we already
  // pointed to a placeholder. Let's just rebuild the page objects with correct parent.
  // Actually, the approach above has a circular reference issue. Let me use a simpler strategy:
  // rebuild everything in the correct order.

  // --- Re-do with correct ordering ---
  // Reset
  objects.length = 0
  currentObjNum = 0

  // 1: Catalog (placeholder, will reference pages)
  const catalogId = addObj("") // placeholder
  // 2: Pages (placeholder)
  const pagesId = addObj("") // placeholder

  // Fonts
  const f1 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  const f2 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

  const resDictStr = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >>`

  // Content streams + footer streams + page objects
  const finalPageIds: number[] = []
  for (let i = 0; i < pages.length; i++) {
    // Main content stream
    const stream = pages[i].join("\n")
    const contentId = addObj(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`)

    // Footer stream (page number)
    const footer = `0.5 0.5 0.55 rg\nBT /F1 7 Tf ${(pageWidth / 2 - 20).toFixed(2)} 25 Td (Page ${i + 1} of ${pages.length}) Tj ET\n`
    const footerId = addObj(`<< /Length ${new TextEncoder().encode(footer).length} >>\nstream\n${footer}\nendstream`)

    // Page object
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents [${contentId} 0 R ${footerId} 0 R] /Resources ${resDictStr} >>`
    )
    finalPageIds.push(pageId)
  }

  // Now fix the placeholder objects
  const kidsArray = finalPageIds.map((id) => `${id} 0 R`).join(" ")
  objects[catalogId - 1].content = `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`
  objects[pagesId - 1].content = `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kidsArray}] /Count ${pages.length} >>\nendobj\n`

  // Assemble final PDF bytes
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
  pdf += `<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`
  pdf += "startxref\n"
  pdf += `${xrefOffset}\n`
  pdf += "%%EOF"

  return new TextEncoder().encode(pdf)
}
