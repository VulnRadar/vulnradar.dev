import type { ScanResult, Severity } from "./scanner/types"
import { APP_NAME, APP_URL, TOTAL_CHECKS_LABEL } from "./constants"
import { SEVERITY_LEVELS } from "@/lib/constants"
import { getSafetyRating } from "./scanner/safety-rating"

// Lightweight multi-page PDF generation using raw PDF syntax -- no external deps
export function generatePdfReport(result: ScanResult): Uint8Array {
  const pageWidth = 595.28 // A4 width in points
  const pageHeight = 841.89
  const margin = 50
  const contentWidth = pageWidth - margin * 2
  const bottomMargin = margin + 30

  const SEVERITY_COLORS: Record<Severity, [number, number, number]> = {
    critical: [0.84, 0.15, 0.15],
    high: [0.95, 0.4, 0.1],
    medium: [0.85, 0.65, 0.1],
    low: [0.2, 0.5, 0.9],
    info: [0.5, 0.5, 0.55],
  }

  const BRAND_COLOR: [number, number, number] = [0.1, 0.7, 0.8]
  const BRAND_DARK: [number, number, number] = [0.05, 0.35, 0.4]
  const TEXT_PRIMARY: [number, number, number] = [0.1, 0.1, 0.12]
  const TEXT_SECONDARY: [number, number, number] = [0.4, 0.4, 0.45]
  const TEXT_MUTED: [number, number, number] = [0.55, 0.55, 0.6]

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
      const c = color || TEXT_PRIMARY
      cmd += `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg\n`
      cmd += `BT ${font} ${size} Tf ${margin} ${y.toFixed(2)} Td (${escPdf(line)}) Tj ET\n`
      currentPageStreams.push(cmd)
      y -= lineHeight
    }
  }

  function addTextRight(text: string, size: number, bold: boolean = false, color?: [number, number, number]) {
    const font = bold ? "/F2" : "/F1"
    const approxWidth = text.length * size * 0.5
    const x = pageWidth - margin - approxWidth
    ensureSpace(size * 1.4)
    const c = color || TEXT_PRIMARY
    let cmd = `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg\n`
    cmd += `BT ${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escPdf(text)}) Tj ET\n`
    currentPageStreams.push(cmd)
  }

  function addLine(weight: number = 0.5) {
    ensureSpace(12)
    currentPageStreams.push(
      `0.85 0.85 0.87 RG\n${weight} w\n${margin} ${y.toFixed(2)} m ${pageWidth - margin} ${y.toFixed(2)} l S\n`
    )
    y -= 10
  }

  function addColorLine(color: [number, number, number], weight: number = 1.5) {
    ensureSpace(12)
    currentPageStreams.push(
      `${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} RG\n${weight} w\n${margin} ${y.toFixed(2)} m ${pageWidth - margin} ${y.toFixed(2)} l S\n`
    )
    y -= 10
  }

  function addRect(x: number, rectY: number, w: number, h: number, color: [number, number, number]) {
    currentPageStreams.push(
      `${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} rg\n${x.toFixed(2)} ${rectY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`
    )
  }

  function addSpacer(h: number) {
    y -= h
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════════

  // Top accent bar
  addRect(0, pageHeight - 8, pageWidth, 8, BRAND_COLOR)

  addSpacer(40)

  // Logo area -- text-based brand mark
  addText(APP_NAME.toUpperCase(), 28, true, BRAND_COLOR)
  addSpacer(2)
  addText("Security Vulnerability Report", 14, false, TEXT_SECONDARY)

  addSpacer(20)
  addColorLine(BRAND_COLOR, 2)
  addSpacer(20)

  // Target info block
  addText("TARGET", 9, true, TEXT_MUTED)
  addSpacer(2)
  addText(result.url, 16, true, TEXT_PRIMARY)

  addSpacer(20)

  // Scan metadata in a grid-like layout
  const scanDate = new Date(result.scannedAt)
  addText("SCAN DATE", 9, true, TEXT_MUTED)
  addSpacer(2)
  addText(scanDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }), 11, false, TEXT_PRIMARY)
  addText(scanDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), 10, false, TEXT_SECONDARY)

  addSpacer(14)

  addText("DURATION", 9, true, TEXT_MUTED)
  addSpacer(2)
  addText(`${(result.duration / 1000).toFixed(1)} seconds`, 11, false, TEXT_PRIMARY)

  addSpacer(14)

  addText("CHECKS PERFORMED", 9, true, TEXT_MUTED)
  addSpacer(2)
  addText(`${TOTAL_CHECKS_LABEL} security checks across headers, SSL, content, cookies, DNS, and configuration`, 11, false, TEXT_PRIMARY)

  addSpacer(14)

  addText("TOTAL FINDINGS", 9, true, TEXT_MUTED)
  addSpacer(2)
  addText(`${result.findings.length} issue${result.findings.length !== 1 ? "s" : ""} detected`, 11, false, TEXT_PRIMARY)

  addSpacer(24)
  addLine()
  addSpacer(16)

  // Safety Rating -- prominent
  const rating = getSafetyRating(result.findings)
  const ratingConfig = {
    safe: { label: "SAFE TO VIEW", color: [0.1, 0.65, 0.3] as [number, number, number], desc: "No critical or actively exploitable vulnerabilities were detected." },
    caution: { label: "VIEW WITH CAUTION", color: [0.85, 0.65, 0.1] as [number, number, number], desc: "Some security issues were detected that may require attention." },
    unsafe: { label: "NOT SAFE TO VIEW", color: [0.8, 0.2, 0.2] as [number, number, number], desc: "Critical exploitable vulnerabilities were detected." },
  }
  const rc = ratingConfig[rating]

  addText("SAFETY RATING", 9, true, TEXT_MUTED)
  addSpacer(4)
  addText(rc.label, 20, true, rc.color)
  addSpacer(2)
  addText(rc.desc, 10, false, TEXT_SECONDARY)

  addSpacer(24)
  addLine()
  addSpacer(16)

  // Severity breakdown
  addText("SEVERITY BREAKDOWN", 9, true, TEXT_MUTED)
  addSpacer(6)
  const severities: Severity[] = [
    SEVERITY_LEVELS.CRITICAL,
    SEVERITY_LEVELS.HIGH,
    SEVERITY_LEVELS.MEDIUM,
    SEVERITY_LEVELS.LOW,
    SEVERITY_LEVELS.INFO
  ] as Severity[]
  for (const sev of severities) {
    const count = result.summary[sev]
    const bar = count > 0 ? ` ${"#".repeat(Math.min(count, 30))}` : ""
    addText(`  ${sev.toUpperCase().padEnd(10)} ${String(count).padStart(3)}${bar}`, 10, count > 0, count > 0 ? SEVERITY_COLORS[sev] : TEXT_MUTED)
    addSpacer(2)
  }

  addSpacer(30)

  // Footer on cover page
  addText(`Generated by ${APP_NAME} (${APP_URL})`, 8, false, TEXT_MUTED)
  addText("This report is intended for authorized security testing purposes only.", 8, false, TEXT_MUTED)
  addText(`Report generated: ${new Date().toISOString()}`, 8, false, TEXT_MUTED)

  // Push cover page
  pages.push(currentPageStreams)
  currentPageStreams = []
  y = pageHeight - margin

  // ═══════════════════════════════════════════════════════════════════════════
  // FINDINGS PAGES
  // ═══════════════════════════════════════════════════════════════════════════

  // Page header on each findings page
  function addPageHeader() {
    addTextRight(`${APP_NAME} Security Report`, 7, false, TEXT_MUTED)
    addSpacer(4)
    addColorLine(BRAND_COLOR, 0.5)
    addSpacer(8)
  }

  addPageHeader()

  if (result.findings.length > 0) {
    addText("DETAILED FINDINGS", 16, true, BRAND_DARK)
    addSpacer(12)

    for (let i = 0; i < result.findings.length; i++) {
      const f = result.findings[i]

      // Check if we need a new page -- estimate header + description minimum
      ensureSpace(90)

      // If we just started a new page, add the header
      if (currentPageStreams.length === 0) {
        addPageHeader()
      }

      // Finding number and severity
      addText(`${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`, 11, true, SEVERITY_COLORS[f.severity])
      addSpacer(2)

      // Category tag
      addText(`Category: ${f.category.replace("-", " ").toUpperCase()}`, 7, true, TEXT_MUTED)
      addSpacer(4)

      // Description
      addText(f.description, 9, false, TEXT_PRIMARY)
      addSpacer(3)

      // Evidence
      addText(`Evidence: ${f.evidence}`, 8, false, TEXT_SECONDARY)
      addSpacer(3)

      // Risk impact
      addText(`Risk: ${f.riskImpact}`, 8, false, TEXT_SECONDARY)
      addSpacer(3)

      // Explanation
      if (f.explanation) {
        addText(`Analysis: ${f.explanation}`, 8, false, [0.3, 0.3, 0.35])
        addSpacer(3)
      }

      // Fix steps
      if (f.fixSteps.length > 0) {
        addText("Remediation Steps:", 8, true, BRAND_DARK)
        for (let s = 0; s < f.fixSteps.length; s++) {
          addText(`  ${s + 1}. ${f.fixSteps[s]}`, 8, false, TEXT_PRIMARY)
        }
        addSpacer(3)
      }

      // Code examples
      if (f.codeExamples && f.codeExamples.length > 0) {
        addText("Code Examples:", 8, true, BRAND_DARK)
        for (const example of f.codeExamples) {
          if (example.label) {
            addText(`  ${example.label}:`, 8, true, TEXT_SECONDARY)
          }
          const codeLines = example.code.split("\n")
          for (const codeLine of codeLines) {
            addText(`    ${codeLine}`, 7, false, TEXT_MUTED)
          }
          addSpacer(2)
        }
      }

      addSpacer(6)
      addLine(0.3)
      addSpacer(6)
    }
  } else {
    addText("No vulnerabilities were detected.", 12, false, [0.1, 0.65, 0.3])
    addSpacer(8)
    addText("All security checks passed successfully. The target appears to be well-configured.", 10, false, TEXT_SECONDARY)
  }

  // Final page -- summary footer
  addSpacer(16)
  addColorLine(BRAND_COLOR, 0.5)
  addSpacer(8)
  addText("END OF REPORT", 9, true, TEXT_MUTED)
  addSpacer(4)
  addText(`${APP_NAME} scanned ${result.url} with ${TOTAL_CHECKS_LABEL} checks on ${scanDate.toLocaleDateString()}.`, 8, false, TEXT_MUTED)
  addText(`This report contains ${result.findings.length} finding(s). For the latest results, re-scan at ${APP_URL}.`, 8, false, TEXT_MUTED)

  // Push last page
  if (currentPageStreams.length > 0) {
    pages.push(currentPageStreams)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSEMBLE MULTI-PAGE PDF
  // ═══════════════════════════════════════════════════════════════════════════

  const objects: { content: string }[] = []
  let currentObjNum = 0

  function addObj(content: string) {
    currentObjNum++
    objects.push({ content: `${currentObjNum} 0 obj\n${content}\nendobj\n` })
    return currentObjNum
  }

  // Placeholder catalog + pages
  const catalogId = addObj("")
  const pagesId = addObj("")

  // Fonts (shared)
  const f1 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  const f2 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
  const resDictStr = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >>`

  // Build page objects
  const finalPageIds: number[] = []
  for (let i = 0; i < pages.length; i++) {
    const stream = pages[i].join("\n")
    const contentId = addObj(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`)

    // Footer with page number and brand
    const pageLabel = i === 0 ? `${APP_NAME} Security Report` : `${APP_NAME} - Page ${i + 1} of ${pages.length}`
    const footer = `0.55 0.55 0.6 rg\nBT /F1 7 Tf ${margin} 25 Td (${escPdf(pageLabel)}) Tj ET\nBT /F1 7 Tf ${(pageWidth - margin - 60).toFixed(2)} 25 Td (${escPdf(`Page ${i + 1} / ${pages.length}`)}) Tj ET\n`
    const footerId = addObj(`<< /Length ${new TextEncoder().encode(footer).length} >>\nstream\n${footer}\nendstream`)

    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents [${contentId} 0 R ${footerId} 0 R] /Resources ${resDictStr} >>`
    )
    finalPageIds.push(pageId)
  }

  // Fix placeholders
  const kidsArray = finalPageIds.map((id) => `${id} 0 R`).join(" ")
  objects[catalogId - 1].content = `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`
  objects[pagesId - 1].content = `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kidsArray}] /Count ${pages.length} >>\nendobj\n`

  // Assemble PDF bytes
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
