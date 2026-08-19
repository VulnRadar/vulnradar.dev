import type { Category, Vulnerability } from "@/lib/scanner/types";

/**
 * Compliance control mappings.
 *
 * A data module that translates a finding's own attributes (its OWASP Top 10
 * category tag, its CWE id, or, as a last resort, its scanner category) into
 * the security controls it touches across four frameworks:
 *
 *   - PCI DSS 4.0            (requirement numbers)
 *   - SOC 2                  (2017 Trust Services Criteria, the CC series)
 *   - ISO/IEC 27001:2022     (Annex A control numbers)
 *   - OWASP ASVS 4.0         (verification chapter numbers)
 *
 * WHERE THE MAPPINGS COME FROM, and how far to trust them:
 *
 *   - The backbone is the OWASP Top 10 (2021) -> framework crosswalk below.
 *     OWASP already publishes the CWE list behind each Top 10 category, and
 *     each framework's own documentation describes which requirements govern
 *     that class of weakness. So "A03 Injection touches PCI 6.2.4, ISO A.8.28,
 *     ASVS V5" is a documented, defensible relationship, not a guess.
 *   - `CWE_TO_OWASP` reuses that backbone: rather than hand-author a separate
 *     control table per CWE (and risk inventing numbers), each supported CWE is
 *     routed to the OWASP category it belongs to, then mapped through the same
 *     vetted table. Where a CWE spans categories, it is bucketed pragmatically
 *     toward the category a reader would expect (e.g. cookie flags -> A05
 *     Security Misconfiguration, matching OWASP's own 2021 CWE list).
 *   - `CATEGORY_TO_OWASP` is a coarse fallback used ONLY when a finding carries
 *     neither an OWASP tag nor a mappable CWE. Some categories (dns, email,
 *     reputation) are deliberately left out: they do not map cleanly to these
 *     web-application control frameworks, so their findings surface honestly in
 *     the report's "Unmapped findings" section instead of being force-fit.
 *
 * These mappings are INDICATIVE, meant to point an engineer or a GRC reviewer
 * at the requirements a finding is relevant to. They are not an authoritative
 * control assessment and they do not establish compliance. The report built on
 * top of this module (compliance-report.ts) states that in its disclaimer.
 */

export type FrameworkKey = "pci" | "soc2" | "iso27001" | "asvs";

export interface FrameworkMeta {
  key: FrameworkKey;
  name: string;
  /** One honest line on what a mapping to this framework does and does not mean. */
  blurb: string;
}

/** Display order for the report, most operationally familiar first. */
export const FRAMEWORKS: FrameworkMeta[] = [
  {
    key: "pci",
    name: "PCI DSS 4.0",
    blurb:
      "Payment Card Industry Data Security Standard. Requirement numbers below are the ones a finding is relevant to, not an assessed pass or fail.",
  },
  {
    key: "soc2",
    name: "SOC 2 (Trust Services Criteria)",
    blurb:
      "AICPA 2017 Trust Services Criteria. Findings map to the Common Criteria (CC) that a Type II audit would gather evidence against.",
  },
  {
    key: "iso27001",
    name: "ISO/IEC 27001:2022 (Annex A)",
    blurb:
      "Annex A control references. A mapping means the finding is in scope for that control, not that the control is implemented or ineffective.",
  },
  {
    key: "asvs",
    name: "OWASP ASVS 4.0",
    blurb:
      "Application Security Verification Standard. Chapter references point to the verification requirements that cover this class of finding.",
  },
];

export interface ControlRef {
  framework: FrameworkKey;
  /** The control/requirement identifier, e.g. "6.2.4", "CC6.1", "A.8.28", "V5". */
  id: string;
  /** Human-readable control title. */
  title: string;
}

/**
 * Control catalog: one short, verifiable title per referenced control. Kept
 * central so the OWASP crosswalk below only has to name (framework, id) pairs
 * and titles never drift between sections of the report.
 */
const CONTROLS: Record<FrameworkKey, Record<string, string>> = {
  pci: {
    "1.3": "Network access to and from the cardholder data environment is restricted",
    "2.2": "Secure configurations are applied to all system components",
    "3.5": "Stored account data (PAN) is secured wherever it is kept",
    "4.2.1":
      "Strong cryptography protects data in transit over open, public networks",
    "6.2.4":
      "Secure coding prevents common software attacks (injection, XSS, and similar)",
    "6.3.1": "Security vulnerabilities are identified and managed",
    "6.3.3": "Components are protected from known vulnerabilities by patching",
    "6.4.1": "Public-facing web applications are protected against attacks",
    "6.4.3": "Payment page scripts are authorized and integrity-assured",
    "7.2": "Access to system components and data is restricted by need to know",
    "8.3": "Strong authentication for users and administrators is enforced",
    "10.2": "Audit logs record events needed to detect anomalies",
    "11.6.1":
      "A change- and tamper-detection mechanism watches the payment page",
  },
  soc2: {
    "CC6.1":
      "Logical access controls protect information assets from unauthorized access",
    "CC6.3":
      "Access is granted, modified, and removed based on roles and least privilege",
    "CC6.6":
      "Security measures protect against threats from outside the system boundary",
    "CC6.7": "Data is protected during transmission, movement, and removal",
    "CC6.8":
      "Controls prevent or detect the introduction of unauthorized or malicious software",
    "CC7.1":
      "Configuration and vulnerabilities are monitored to detect susceptibility",
    "CC7.2": "System components are monitored for anomalies and security events",
    "CC8.1":
      "Changes to infrastructure and software are authorized, tested, and approved",
  },
  iso27001: {
    "A.5.14": "Information transfer",
    "A.8.3": "Information access restriction",
    "A.8.5": "Secure authentication",
    "A.8.8": "Management of technical vulnerabilities",
    "A.8.9": "Configuration management",
    "A.8.15": "Logging",
    "A.8.16": "Monitoring activities",
    "A.8.23": "Web filtering",
    "A.8.24": "Use of cryptography",
    "A.8.26": "Application security requirements",
    "A.8.27": "Secure system architecture and engineering principles",
    "A.8.28": "Secure coding",
  },
  asvs: {
    V1: "Architecture, Design and Threat Modeling",
    V2: "Authentication",
    V3: "Session Management",
    V4: "Access Control",
    V5: "Validation, Sanitization and Encoding",
    V6: "Stored Cryptography",
    V7: "Error Handling and Logging",
    V8: "Data Protection",
    V9: "Communication",
    V10: "Malicious Code",
    V12: "Files and Resources",
    V13: "API and Web Service",
    V14: "Configuration",
  },
};

/**
 * OWASP Top 10 (2021) category -> the controls each framework uses to govern
 * that class of weakness. This is the vetted backbone every finding resolves
 * through. Keys are normalized OWASP ids ("A01" through "A10").
 */
const OWASP_CONTROL_REFS: Record<string, Array<[FrameworkKey, string]>> = {
  // A01 Broken Access Control
  A01: [
    ["pci", "7.2"],
    ["pci", "6.2.4"],
    ["soc2", "CC6.1"],
    ["soc2", "CC6.3"],
    ["iso27001", "A.8.3"],
    ["asvs", "V4"],
  ],
  // A02 Cryptographic Failures
  A02: [
    ["pci", "4.2.1"],
    ["pci", "3.5"],
    ["soc2", "CC6.1"],
    ["soc2", "CC6.7"],
    ["iso27001", "A.8.24"],
    ["iso27001", "A.5.14"],
    ["asvs", "V6"],
    ["asvs", "V9"],
  ],
  // A03 Injection (includes cross-site scripting)
  A03: [
    ["pci", "6.2.4"],
    ["soc2", "CC6.1"],
    ["soc2", "CC7.1"],
    ["iso27001", "A.8.28"],
    ["iso27001", "A.8.26"],
    ["asvs", "V5"],
  ],
  // A04 Insecure Design
  A04: [
    ["pci", "6.2.4"],
    ["soc2", "CC8.1"],
    ["iso27001", "A.8.27"],
    ["iso27001", "A.8.26"],
    ["asvs", "V1"],
  ],
  // A05 Security Misconfiguration (headers, cookies, config, CORS, XXE)
  A05: [
    ["pci", "2.2"],
    ["pci", "6.4.1"],
    ["soc2", "CC6.6"],
    ["soc2", "CC7.1"],
    ["iso27001", "A.8.9"],
    ["iso27001", "A.8.26"],
    ["asvs", "V14"],
  ],
  // A06 Vulnerable and Outdated Components
  A06: [
    ["pci", "6.3.1"],
    ["pci", "6.3.3"],
    ["soc2", "CC7.1"],
    ["iso27001", "A.8.8"],
    ["asvs", "V14"],
  ],
  // A07 Identification and Authentication Failures
  A07: [
    ["pci", "8.3"],
    ["soc2", "CC6.1"],
    ["iso27001", "A.8.5"],
    ["asvs", "V2"],
    ["asvs", "V3"],
  ],
  // A08 Software and Data Integrity Failures (deserialization, SRI, integrity)
  A08: [
    ["pci", "6.4.3"],
    ["pci", "11.6.1"],
    ["soc2", "CC8.1"],
    ["soc2", "CC7.1"],
    ["iso27001", "A.8.28"],
    ["iso27001", "A.8.26"],
    ["asvs", "V10"],
    ["asvs", "V1"],
  ],
  // A09 Security Logging and Monitoring Failures
  A09: [
    ["pci", "10.2"],
    ["soc2", "CC7.2"],
    ["iso27001", "A.8.15"],
    ["iso27001", "A.8.16"],
    ["asvs", "V7"],
  ],
  // A10 Server-Side Request Forgery
  A10: [
    ["pci", "6.2.4"],
    ["pci", "1.3"],
    ["soc2", "CC6.6"],
    ["iso27001", "A.8.26"],
    ["iso27001", "A.8.28"],
    ["asvs", "V12"],
  ],
};

/**
 * CWE -> OWASP Top 10 (2021) category, covering every CWE the scanner emits
 * plus the common neighbours. Grounded in OWASP's published per-category CWE
 * lists; where a CWE could sit in more than one category it is placed where a
 * reader (and the scanner's own owasp tag) would expect it.
 */
const CWE_TO_OWASP: Record<string, string> = {
  // A01 Broken Access Control
  "CWE-22": "A01",
  "CWE-200": "A01",
  "CWE-284": "A01",
  "CWE-352": "A01",
  "CWE-538": "A01",
  "CWE-598": "A01",
  "CWE-601": "A01",
  "CWE-639": "A01",
  "CWE-862": "A01",
  // A02 Cryptographic Failures
  "CWE-208": "A02",
  "CWE-295": "A02",
  "CWE-298": "A02",
  "CWE-299": "A02",
  "CWE-312": "A02",
  "CWE-319": "A02",
  "CWE-326": "A02",
  "CWE-327": "A02",
  "CWE-330": "A02",
  "CWE-347": "A02",
  // A03 Injection
  "CWE-20": "A03",
  "CWE-78": "A03",
  "CWE-79": "A03",
  "CWE-89": "A03",
  "CWE-90": "A03",
  "CWE-94": "A03",
  "CWE-644": "A03",
  "CWE-1321": "A03",
  "CWE-1336": "A03",
  // A04 Insecure Design
  "CWE-209": "A04",
  "CWE-434": "A04",
  "CWE-602": "A04",
  "CWE-636": "A04",
  "CWE-799": "A04",
  // A05 Security Misconfiguration
  "CWE-16": "A05",
  "CWE-346": "A05",
  "CWE-350": "A05",
  "CWE-444": "A05",
  "CWE-489": "A05",
  "CWE-525": "A05",
  "CWE-540": "A05",
  "CWE-548": "A05",
  "CWE-611": "A05",
  "CWE-614": "A05",
  "CWE-615": "A05",
  "CWE-693": "A05",
  "CWE-942": "A05",
  "CWE-1004": "A05",
  "CWE-1021": "A05",
  "CWE-1022": "A05",
  "CWE-1275": "A05",
  // A06 Vulnerable and Outdated Components
  "CWE-1104": "A06",
  // A07 Identification and Authentication Failures
  "CWE-204": "A07",
  "CWE-287": "A07",
  "CWE-290": "A07",
  "CWE-294": "A07",
  "CWE-306": "A07",
  "CWE-384": "A07",
  "CWE-521": "A07",
  "CWE-522": "A07",
  "CWE-613": "A07",
  "CWE-697": "A07",
  "CWE-798": "A07",
  "CWE-1392": "A07",
  // A08 Software and Data Integrity Failures
  "CWE-345": "A08",
  "CWE-353": "A08",
  "CWE-502": "A08",
  "CWE-506": "A08",
  "CWE-829": "A08",
  "CWE-915": "A08",
  // A10 Server-Side Request Forgery
  "CWE-918": "A10",
};

/**
 * Coarse category -> OWASP fallback, used only when a finding has neither an
 * OWASP tag nor a mappable CWE. dns, email, and reputation are intentionally
 * absent: they do not map cleanly onto these web-app frameworks, so their
 * findings land in the report's "Unmapped findings" section rather than being
 * forced into a control they do not really touch.
 */
const CATEGORY_TO_OWASP: Partial<Record<Category, string>> = {
  headers: "A05",
  cookies: "A05",
  configuration: "A05",
  "information-disclosure": "A05",
  "supply-chain": "A06",
  api: "A05",
  ssl: "A02",
  tls: "A02",
  content: "A03",
  "client-side": "A03",
  code: "A03",
  "vibe-code": "A05",
  "secrets-extended": "A07",
  "host-validation": "A01",
  "active-probes": "A03",
};

/** "A03:2021", "A3:2021", "A03" -> "A03". Returns null if it is not an A0x id. */
function normalizeOwasp(owasp: string | undefined): string | null {
  if (!owasp) return null;
  const match = /A(\d{1,2})/i.exec(owasp);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isInteger(num) || num < 1 || num > 10) return null;
  return `A${String(num).padStart(2, "0")}`;
}

/** "cwe-79", "CWE-79" -> "CWE-79". Returns null if it is not a CWE id. */
function normalizeCwe(cwe: string | undefined): string | null {
  if (!cwe) return null;
  const match = /CWE-(\d+)/i.exec(cwe);
  if (!match) return null;
  return `CWE-${match[1]}`;
}

/**
 * Every OWASP Top 10 category a finding maps into. Combines its own OWASP tag
 * with the CWE crosswalk (both can contribute, deduplicated). Only if that
 * yields nothing does the coarse category fallback apply. May be empty, which
 * is what marks a finding as unmappable.
 */
function resolveOwaspKeys(finding: Vulnerability): string[] {
  const keys = new Set<string>();

  const tagged = normalizeOwasp(finding.owasp);
  if (tagged && OWASP_CONTROL_REFS[tagged]) keys.add(tagged);

  const cwe = normalizeCwe(finding.cwe);
  if (cwe) {
    const viaCwe = CWE_TO_OWASP[cwe];
    if (viaCwe && OWASP_CONTROL_REFS[viaCwe]) keys.add(viaCwe);
  }

  if (keys.size === 0) {
    const viaCategory = CATEGORY_TO_OWASP[finding.category];
    if (viaCategory && OWASP_CONTROL_REFS[viaCategory]) keys.add(viaCategory);
  }

  return [...keys];
}

/**
 * The framework controls a single finding is relevant to, deduplicated across
 * every OWASP category it resolves into. Empty array means the finding could
 * not be mapped to any framework, and the report lists it as such rather than
 * dropping it.
 */
export function getControlsForFinding(finding: Vulnerability): ControlRef[] {
  const seen = new Set<string>();
  const refs: ControlRef[] = [];

  for (const key of resolveOwaspKeys(finding)) {
    for (const [framework, id] of OWASP_CONTROL_REFS[key]) {
      const dedupeKey = `${framework}:${id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      refs.push({
        framework,
        id,
        title: CONTROLS[framework]?.[id] ?? id,
      });
    }
  }

  return refs;
}
