import type { ScanResult, Severity } from "@/lib/scanner/types";
import {
  APP_NAME,
  APP_URL,
  TOTAL_CHECKS_LABEL,
  SEVERITY_LEVELS,
} from "@/lib/config/constants";
import { BRAND } from "@/lib/config/brand";
import { getSafetyRating } from "@/lib/scanner/safety-rating";

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

// PDF colour operators take three floats in 0..1, the brand is defined in hex
// (lib/config/brand.ts, the single source of truth for surfaces that leave the
// app). This converts between the two so the report can't drift from the
// product the way it had: the cover bar, the wordmark and every section head
// were still the old teal #1AB3CC long after the brand moved to blue.
function hexToPdfRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

const BRAND_COLOR = hexToPdfRgb(BRAND.primaryLight);
const BRAND_DARK = hexToPdfRgb(BRAND.primary);

const SEVERITY_COLORS: Record<Severity, [number, number, number]> = {
  critical: hexToPdfRgb(BRAND.severity.critical),
  high: hexToPdfRgb(BRAND.severity.high),
  medium: hexToPdfRgb(BRAND.severity.medium),
  low: hexToPdfRgb(BRAND.severity.low),
  info: hexToPdfRgb(BRAND.severity.info),
};

const RATING_COLORS = {
  safe: hexToPdfRgb(BRAND.success),
  caution: hexToPdfRgb(BRAND.severity.medium),
  unsafe: hexToPdfRgb(BRAND.severity.critical),
};

// The rest of BRAND describes a dark UI surface, and this document is printed
// on white paper: BRAND.text (#f1f5f9) on white is invisible. These are the
// light-surface equivalents of BRAND.text / textMuted / textFaint, kept as
// literals for that reason rather than because they were never reviewed.
const TEXT_PRIMARY: [number, number, number] = [0.1, 0.1, 0.12];
const TEXT_SECONDARY: [number, number, number] = [0.4, 0.4, 0.45];
const TEXT_MUTED: [number, number, number] = [0.55, 0.55, 0.6];
const BAR_TRACK: [number, number, number] = [0.9, 0.9, 0.92];

// ---------------------------------------------------------------------------
// Text encoding
// ---------------------------------------------------------------------------

// The fonts below are declared /WinAnsiEncoding (CP1252), a single-byte
// encoding. CP1252 agrees with Unicode everywhere except 0x80-0x9F, where it
// puts these 27 typographic characters instead of control codes, so that block
// is the only part that needs a table.
const WIN_ANSI_HIGH: Record<string, number> = {
  "\u20ac": 0x80,
  "\u201a": 0x82,
  "\u0192": 0x83,
  "\u201e": 0x84,
  "\u2026": 0x85,
  "\u2020": 0x86,
  "\u2021": 0x87,
  "\u02c6": 0x88,
  "\u2030": 0x89,
  "\u0160": 0x8a,
  "\u2039": 0x8b,
  "\u0152": 0x8c,
  "\u017d": 0x8e,
  "\u2018": 0x91,
  "\u2019": 0x92,
  "\u201c": 0x93,
  "\u201d": 0x94,
  "\u2022": 0x95,
  "\u2013": 0x96,
  "\u2014": 0x97,
  "\u02dc": 0x98,
  "\u2122": 0x99,
  "\u0161": 0x9a,
  "\u203a": 0x9b,
  "\u0153": 0x9c,
  "\u017e": 0x9e,
  "\u0178": 0x9f,
};

// Characters WinAnsi has no slot for at all get a readable ASCII stand-in
// rather than a "?" box. The arrow matters most: 94 of the 96 non-ASCII
// characters in lib/scanner/checks-data are U+2192, and most of them sit in
// the remediation steps of secret-exposure findings ("Revoke the token via
// GitHub Settings -> Developer Settings"), which is the single highest-stakes
// instruction the scanner produces.
const ASCII_FALLBACK: Record<string, string> = {
  "\u2192": "->", // right arrow, by far the most common in checks-data
  "\u2190": "<-",
  "\u2194": "<->",
  "\u21d2": "=>",
  "\u21d0": "<=",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u2248": "~=",
  "\u2212": "-", // minus sign
  "\u2011": "-", // non-breaking hyphen
  "\u2012": "-",
  "\u2015": "-",
  "\u2032": "'", // prime
  "\u2033": '"', // double prime
  "\u2605": "*",
  "\u2606": "*",
  "\u2713": "OK",
  "\u2714": "OK",
  "\u2705": "OK",
  "\u2717": "X",
  "\u2718": "X",
  "\u274c": "X",
  "\u26a0": "!",
  "\u200b": "", // zero-width space, joiners and BOM: drop entirely
  "\u200c": "",
  "\u200d": "",
  "\ufeff": "",
  "\u2002": " ", // en, em, thin, hair and narrow no-break spaces
  "\u2003": " ",
  "\u2009": " ",
  "\u200a": " ",
  "\u202f": " ",
  "\t": "  ",
  "\n": " ",
  "\r": "",
};

function winAnsiByte(ch: string): number | null {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return null;
  if (cp >= 0x20 && cp <= 0x7e) return cp;
  if (cp === 0xa0) return 0x20; // WinAnsi maps 0xA0 (nbsp) to a plain space
  if (cp >= 0xa1 && cp <= 0xff) return cp;
  const high = WIN_ANSI_HIGH[ch];
  return high === undefined ? null : high;
}

/**
 * Transcode arbitrary text to a string where every char code is the CP1252
 * byte that should reach the content stream.
 *
 * This is the fix for the mojibake: the document is emitted with
 * `TextEncoder().encode()` (UTF-8), so a multi-byte character used to arrive
 * at a WinAnsi font as N independent single-byte glyph codes, turning an
 * arrow into three unrelated Latin-1 glyphs. Doing the conversion here means the wrapper below also
 * measures the real number of glyphs rather than JS code units.
 */
function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const sub = ASCII_FALLBACK[ch];
    if (sub !== undefined) {
      out += sub;
      continue;
    }
    const byte = winAnsiByte(ch);
    if (byte !== null) {
      out += String.fromCharCode(byte);
      continue;
    }
    // Last resort: drop the diacritic (U+0101 -> "a"). If the base character
    // still has no slot, "?" is better than a byte the viewer would draw as
    // an unrelated glyph.
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const baseByte = base.length === 1 ? winAnsiByte(base) : null;
    out += baseByte !== null ? String.fromCharCode(baseByte) : "?";
  }
  return out;
}

/**
 * Escape a WinAnsi string (the output of toWinAnsi, one char per byte) into a
 * PDF literal. Bytes outside printable ASCII become three-digit octal escapes,
 * so the emitted document is pure ASCII and the UTF-8 encoding at the end is a
 * byte-for-byte identity.
 */
function escPdf(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" || ch === "(" || ch === ")") {
      out += "\\" + ch;
      continue;
    }
    const code = s.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      out += "\\" + code.toString(8).padStart(3, "0");
      continue;
    }
    out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Line breaking
// ---------------------------------------------------------------------------

// Preferred break points inside an oversized token, so a URL, a CSP directive
// list or a base64 hash breaks after a separator instead of mid-token.
const BREAK_AFTER = "/?&=;,.:-_";

function breakLongToken(token: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = token;
  while (rest.length > maxChars) {
    const searchFloor = Math.max(1, maxChars - 12);
    let cut = maxChars;
    for (let i = maxChars - 1; i >= searchFloor; i--) {
      if (BREAK_AFTER.includes(rest[i])) {
        cut = i + 1;
        break;
      }
    }
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Wrap to a character budget.
 *
 * Two things this used to get wrong. It only broke on spaces, so a single
 * token longer than the budget (a redirect chain, a query string, a JWT in a
 * secrets finding's evidence) was drawn as one line past the right margin and
 * silently lost at the page edge. And it trimmed every line, destroying the
 * indentation of code samples and numbered fix steps.
 */
function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const rawIndent = /^ */.exec(text)?.[0] ?? "";
  const body = text.slice(rawIndent.length);
  const budget = Math.max(8, maxChars - rawIndent.length);

  const lines: string[] = [];
  let current = "";
  for (const word of body.split(" ")) {
    if (word.length > budget) {
      if (current) lines.push(current);
      const parts = breakLongToken(word, budget);
      for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
      current = parts[parts.length - 1];
      continue;
    }
    const candidate = current ? current + " " + word : word;
    if (candidate.length > budget) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return (lines.length > 0 ? lines : [""]).map((line) => rawIndent + line);
}

// Average glyph advance as a fraction of the point size. Helvetica is
// proportional so 0.5 is an approximation; Courier is fixed-pitch at exactly
// 600/1000 em, so its budget is exact.
const HELVETICA_RATIO = 0.5;
const COURIER_RATIO = 0.6;

// Lightweight multi-page PDF generation using raw PDF syntax (no external deps)
export function generatePdfReport(result: ScanResult): Uint8Array {
  const pageWidth = 595.28; // A4 width in points
  const pageHeight = 841.89;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;
  const bottomMargin = margin + 30;

  const pages: string[][] = [];
  let currentPageStreams: string[] = [];
  let y = pageHeight - margin;
  // The cover page has its own masthead; findings pages get the running
  // header. This used to be applied only between findings, so a finding that
  // spilled across a page left the continuation page with no header rule.
  let pageHeaderEnabled = false;
  let writingHeader = false;

  function startNewPage() {
    if (currentPageStreams.length > 0) {
      pages.push(currentPageStreams);
    }
    currentPageStreams = [];
    y = pageHeight - margin;
    if (pageHeaderEnabled && !writingHeader) {
      writingHeader = true;
      addPageHeader();
      writingHeader = false;
    }
  }

  function ensureSpace(needed: number) {
    if (y - needed < bottomMargin) {
      startNewPage();
    }
  }

  function drawText(
    text: string,
    size: number,
    font: string,
    widthRatio: number,
    color?: [number, number, number],
  ) {
    const src = toWinAnsi(text);
    const maxCharsPerLine = Math.max(
      8,
      Math.floor(contentWidth / (size * widthRatio)),
    );
    const wrappedLines = wrapText(src, maxCharsPerLine);
    const lineHeight = size * 1.4;

    for (const line of wrappedLines) {
      ensureSpace(lineHeight);
      const c = color || TEXT_PRIMARY;
      let cmd = `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg\n`;
      cmd += `BT ${font} ${size} Tf ${margin} ${y.toFixed(2)} Td (${escPdf(line)}) Tj ET\n`;
      currentPageStreams.push(cmd);
      y -= lineHeight;
    }
  }

  function addText(
    text: string,
    size: number,
    bold: boolean = false,
    color?: [number, number, number],
  ) {
    drawText(text, size, bold ? "/F2" : "/F1", HELVETICA_RATIO, color);
  }

  // Evidence strings and code samples are the parts a reader checks character
  // by character, so they get the fixed-pitch face: alignment survives and the
  // line budget is exact rather than an average-width guess.
  function addMono(
    text: string,
    size: number,
    color?: [number, number, number],
  ) {
    drawText(text, size, "/F3", COURIER_RATIO, color);
  }

  function addTextAt(
    text: string,
    x: number,
    size: number,
    bold: boolean = false,
    color?: [number, number, number],
  ) {
    const src = toWinAnsi(text);
    const c = color || TEXT_PRIMARY;
    let cmd = `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg\n`;
    cmd += `BT ${bold ? "/F2" : "/F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escPdf(src)}) Tj ET\n`;
    currentPageStreams.push(cmd);
  }

  function addTextRight(
    text: string,
    size: number,
    bold: boolean = false,
    color?: [number, number, number],
  ) {
    const src = toWinAnsi(text);
    const approxWidth = src.length * size * HELVETICA_RATIO;
    ensureSpace(size * 1.4);
    addTextAt(src, pageWidth - margin - approxWidth, size, bold, color);
  }

  function addLine(weight: number = 0.5) {
    ensureSpace(12);
    currentPageStreams.push(
      `0.85 0.85 0.87 RG\n${weight} w\n${margin} ${y.toFixed(2)} m ${pageWidth - margin} ${y.toFixed(2)} l S\n`,
    );
    y -= 10;
  }

  function addColorLine(color: [number, number, number], weight: number = 1.5) {
    ensureSpace(12);
    currentPageStreams.push(
      `${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} RG\n${weight} w\n${margin} ${y.toFixed(2)} m ${pageWidth - margin} ${y.toFixed(2)} l S\n`,
    );
    y -= 10;
  }

  function addRect(
    x: number,
    rectY: number,
    w: number,
    h: number,
    color: [number, number, number],
  ) {
    currentPageStreams.push(
      `${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} rg\n${x.toFixed(2)} ${rectY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`,
    );
  }

  function addSpacer(h: number) {
    y -= h;
  }

  // Running header on each findings page.
  function addPageHeader() {
    addTextRight(`${APP_NAME} Security Report`, 7, false, TEXT_MUTED);
    addSpacer(4);
    addColorLine(BRAND_COLOR, 0.5);
    addSpacer(8);
  }

  // ===========================================================================
  // COVER PAGE
  // ===========================================================================

  // Top accent bar
  addRect(0, pageHeight - 8, pageWidth, 8, BRAND_COLOR);

  addSpacer(40);

  // Logo area: text-based brand mark
  addText(APP_NAME.toUpperCase(), 28, true, BRAND_COLOR);
  addSpacer(2);
  addText("Security Vulnerability Report", 14, false, TEXT_SECONDARY);

  addSpacer(20);
  addColorLine(BRAND_COLOR, 2);
  addSpacer(20);

  // Target info block
  addText("TARGET", 9, true, TEXT_MUTED);
  addSpacer(2);
  addText(result.url, 16, true, TEXT_PRIMARY);

  addSpacer(20);

  // Scan metadata in a grid-like layout
  const scanDate = new Date(result.scannedAt);
  addText("SCAN DATE", 9, true, TEXT_MUTED);
  addSpacer(2);
  addText(
    scanDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    11,
    false,
    TEXT_PRIMARY,
  );
  addText(
    scanDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    10,
    false,
    TEXT_SECONDARY,
  );

  addSpacer(14);

  addText("DURATION", 9, true, TEXT_MUTED);
  addSpacer(2);
  addText(
    `${(result.duration / 1000).toFixed(1)} seconds`,
    11,
    false,
    TEXT_PRIMARY,
  );

  addSpacer(14);

  addText("CHECKS PERFORMED", 9, true, TEXT_MUTED);
  addSpacer(2);
  addText(
    `${TOTAL_CHECKS_LABEL} security checks across headers, SSL, content, cookies, DNS, and configuration`,
    11,
    false,
    TEXT_PRIMARY,
  );

  addSpacer(14);

  addText("TOTAL FINDINGS", 9, true, TEXT_MUTED);
  addSpacer(2);
  addText(
    `${result.findings.length} issue${result.findings.length !== 1 ? "s" : ""} detected`,
    11,
    false,
    TEXT_PRIMARY,
  );

  addSpacer(24);
  addLine();
  addSpacer(16);

  // Safety Rating: prominent
  const rating = getSafetyRating(result.findings);
  const ratingConfig = {
    safe: {
      label: "SAFE TO VIEW",
      color: RATING_COLORS.safe,
      desc: "No critical or actively exploitable vulnerabilities were detected.",
    },
    caution: {
      label: "VIEW WITH CAUTION",
      color: RATING_COLORS.caution,
      desc: "Some security issues were detected that may require attention.",
    },
    unsafe: {
      label: "NOT SAFE TO VIEW",
      color: RATING_COLORS.unsafe,
      desc: "Critical exploitable vulnerabilities were detected.",
    },
  };
  const rc = ratingConfig[rating];

  addText("SAFETY RATING", 9, true, TEXT_MUTED);
  addSpacer(4);
  addText(rc.label, 20, true, rc.color);
  addSpacer(2);
  addText(rc.desc, 10, false, TEXT_SECONDARY);

  addSpacer(24);
  addLine();
  addSpacer(16);

  // Severity breakdown: one proportional stacked bar plus a legend, the same
  // information architecture as SeverityDistribution in the app and the
  // severity chip row in the emails. It used to be five rows of "#" repeated
  // and capped at 30, so a target with 40 criticals and 3 lows drew a 30-hash
  // bar next to a 3-hash bar and understated the ratio by more than 4x.
  addText("SEVERITY BREAKDOWN", 9, true, TEXT_MUTED);
  addSpacer(8);
  const severities: Severity[] = [
    SEVERITY_LEVELS.CRITICAL,
    SEVERITY_LEVELS.HIGH,
    SEVERITY_LEVELS.MEDIUM,
    SEVERITY_LEVELS.LOW,
    SEVERITY_LEVELS.INFO,
  ] as Severity[];
  const severityTotal = severities.reduce(
    (n, sev) => n + (result.summary[sev] || 0),
    0,
  );

  const barHeight = 10;
  ensureSpace(barHeight + 24);
  y -= barHeight;
  addRect(margin, y, contentWidth, barHeight, BAR_TRACK);
  if (severityTotal > 0) {
    let segmentX = margin;
    for (const sev of severities) {
      const count = result.summary[sev] || 0;
      if (count <= 0) continue;
      const segmentWidth = (contentWidth * count) / severityTotal;
      addRect(segmentX, y, segmentWidth, barHeight, SEVERITY_COLORS[sev]);
      segmentX += segmentWidth;
    }
    y -= 18;
    let legendX = margin;
    for (const sev of severities) {
      const count = result.summary[sev] || 0;
      if (count <= 0) continue;
      const label = `${count} ${sev}`;
      addRect(legendX, y + 1, 6, 6, SEVERITY_COLORS[sev]);
      addTextAt(label, legendX + 10, 9, false, TEXT_SECONDARY);
      legendX += 10 + label.length * 9 * HELVETICA_RATIO + 16;
    }
    y -= 12;
  } else {
    y -= 18;
    addTextAt("No findings recorded.", margin, 9, false, TEXT_MUTED);
    y -= 12;
  }

  addSpacer(30);

  // Footer on cover page
  addText(`Generated by ${APP_NAME} (${APP_URL})`, 8, false, TEXT_MUTED);
  addText(
    "This report is intended for authorized security testing purposes only.",
    8,
    false,
    TEXT_MUTED,
  );
  addText(
    `Report generated: ${new Date().toISOString()}`,
    8,
    false,
    TEXT_MUTED,
  );

  // Push cover page
  pages.push(currentPageStreams);
  currentPageStreams = [];
  y = pageHeight - margin;

  // ===========================================================================
  // FINDINGS PAGES
  // ===========================================================================

  pageHeaderEnabled = true;
  addPageHeader();

  if (result.findings.length > 0) {
    addText("DETAILED FINDINGS", 16, true, BRAND_DARK);
    addSpacer(12);

    for (let i = 0; i < result.findings.length; i++) {
      const f = result.findings[i];

      // Check if we need a new page: estimate header + description minimum
      ensureSpace(90);

      // Finding number and severity
      addText(
        `${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`,
        11,
        true,
        SEVERITY_COLORS[f.severity],
      );
      addSpacer(2);

      // Category tag
      addText(
        `Category: ${f.category.replace("-", " ").toUpperCase()}`,
        7,
        true,
        TEXT_MUTED,
      );
      addSpacer(4);

      // Description
      addText(f.description, 9, false, TEXT_PRIMARY);
      addSpacer(3);

      // Evidence
      addMono(`Evidence: ${f.evidence}`, 8, TEXT_SECONDARY);
      addSpacer(3);

      // Risk impact
      addText(`Risk: ${f.riskImpact}`, 8, false, TEXT_SECONDARY);
      addSpacer(3);

      // Explanation
      if (f.explanation) {
        addText(`Analysis: ${f.explanation}`, 8, false, [0.3, 0.3, 0.35]);
        addSpacer(3);
      }

      // Fix steps
      if (f.fixSteps.length > 0) {
        addText("Remediation Steps:", 8, true, BRAND_DARK);
        for (let s = 0; s < f.fixSteps.length; s++) {
          addText(`  ${s + 1}. ${f.fixSteps[s]}`, 8, false, TEXT_PRIMARY);
        }
        addSpacer(3);
      }

      // Code examples
      if (f.codeExamples && f.codeExamples.length > 0) {
        addText("Code Examples:", 8, true, BRAND_DARK);
        for (const example of f.codeExamples) {
          if (example.label) {
            addText(`  ${example.label}:`, 8, true, TEXT_SECONDARY);
          }
          const codeLines = example.code.split("\n");
          for (const codeLine of codeLines) {
            addMono(`    ${codeLine}`, 7, TEXT_MUTED);
          }
          addSpacer(2);
        }
      }

      addSpacer(6);
      addLine(0.3);
      addSpacer(6);
    }
  } else {
    addText("No vulnerabilities were detected.", 12, false, RATING_COLORS.safe);
    addSpacer(8);
    addText(
      "All security checks passed successfully. The target appears to be well-configured.",
      10,
      false,
      TEXT_SECONDARY,
    );
  }

  // Final page: summary footer
  addSpacer(16);
  addColorLine(BRAND_COLOR, 0.5);
  addSpacer(8);
  addText("END OF REPORT", 9, true, TEXT_MUTED);
  addSpacer(4);
  addText(
    `${APP_NAME} scanned ${result.url} with ${TOTAL_CHECKS_LABEL} checks on ${scanDate.toLocaleDateString()}.`,
    8,
    false,
    TEXT_MUTED,
  );
  addText(
    `This report contains ${result.findings.length} finding(s). For the latest results, re-scan at ${APP_URL}.`,
    8,
    false,
    TEXT_MUTED,
  );

  // Push last page
  if (currentPageStreams.length > 0) {
    pages.push(currentPageStreams);
  }

  // ===========================================================================
  // ASSEMBLE MULTI-PAGE PDF
  // ===========================================================================

  const objects: { content: string }[] = [];
  let currentObjNum = 0;

  function addObj(content: string) {
    currentObjNum++;
    objects.push({ content: `${currentObjNum} 0 obj\n${content}\nendobj\n` });
    return currentObjNum;
  }

  // Placeholder catalog + pages
  const catalogId = addObj("");
  const pagesId = addObj("");

  // Fonts (shared). /Encoding is required: without it a viewer falls back to
  // the font's built-in StandardEncoding, which has no slot for most of the
  // CP1252 range and disagrees with it on quotes and dashes. Paired with
  // toWinAnsi() above, this is what makes accented characters and the section
  // sign render as themselves instead of as mojibake.
  const f1 = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const f2 = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const f3 = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  );
  const resDictStr = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >>`;

  // Build page objects
  const finalPageIds: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    const stream = pages[i].join("\n");
    const contentId = addObj(
      `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`,
    );

    // Footer with page number and brand
    const pageLabel =
      i === 0
        ? `${APP_NAME} Security Report`
        : `${APP_NAME} - Page ${i + 1} of ${pages.length}`;
    const footer = `0.55 0.55 0.6 rg\nBT /F1 7 Tf ${margin} 25 Td (${escPdf(toWinAnsi(pageLabel))}) Tj ET\nBT /F1 7 Tf ${(pageWidth - margin - 60).toFixed(2)} 25 Td (${escPdf(toWinAnsi(`Page ${i + 1} / ${pages.length}`))}) Tj ET\n`;
    const footerId = addObj(
      `<< /Length ${new TextEncoder().encode(footer).length} >>\nstream\n${footer}\nendstream`,
    );

    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents [${contentId} 0 R ${footerId} 0 R] /Resources ${resDictStr} >>`,
    );
    finalPageIds.push(pageId);
  }

  // Fix placeholders
  const kidsArray = finalPageIds.map((id) => `${id} 0 R`).join(" ");
  objects[catalogId - 1].content =
    `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;
  objects[pagesId - 1].content =
    `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kidsArray}] /Count ${pages.length} >>\nendobj\n`;

  // Assemble PDF bytes. xref offsets must be UTF-8 BYTE offsets, not JS
  // string lengths (UTF-16 code units). Every string that reaches the
  // document is now escaped to pure ASCII by escPdf(), so the two agree, but
  // the byte count is kept because it is the property the format actually
  // requires and a future addition here should not be able to break the xref
  // table silently.
  let pdf = "%PDF-1.4\n";
  let byteLength = Buffer.byteLength(pdf, "utf8");
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(byteLength);
    pdf += obj.content;
    byteLength += Buffer.byteLength(obj.content, "utf8");
  }

  const xrefOffset = byteLength;
  pdf += "xref\n";
  pdf += `0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += "trailer\n";
  pdf += `<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += "startxref\n";
  pdf += `${xrefOffset}\n`;
  pdf += "%%EOF";

  return new TextEncoder().encode(pdf);
}
