export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "headers"
  | "ssl"
  | "content"
  | "cookies"
  | "configuration"
  | "information-disclosure"
  | "dns";

export interface Vulnerability {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  description: string;
  evidence: string;
  riskImpact: string;
  explanation: string;
  fixSteps: string[];
  codeExamples: {
    label: string;
    language: string;
    code: string;
  }[];
  references?: string[];
}

export interface ScanResult {
  url: string;
  scannedAt: string;
  duration: number;
  findings: Vulnerability[];
  checksRun?: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  responseHeaders?: Record<string, string>;
}

export type ScanStatus = "idle" | "scanning" | "done" | "failed";
