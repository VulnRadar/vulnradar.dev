// Shared types for the /repos page and its sub-components (the picker
// modal, the per-repo history panel). Split out so all three can import
// the same shapes without a circular import between page.tsx and its
// components.

import type { ScanResult } from "@/lib/scanner/types";

export interface GithubRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  description: string | null;
}

/** One row of GET /api/v3/scan/github/history's grouped (no ?repo=) shape. */
export interface RepoScanSummary {
  repo: string;
  lastScan: {
    id: number;
    summary: ScanResult["summary"];
    findingsCount: number;
    duration: number;
    scannedAt: string;
  };
  scanCount: number;
}

/** What POST /api/v3/scan/github returns: a full ScanResult plus a few
 *  GitHub-specific extras -- see app/api/v3/scan/github/route.ts. */
export interface GithubScanOutcome {
  result: ScanResult;
  scanHistoryId: number | null;
  ref: string;
  filesScanned: number;
  filesSkippedByCaps: number;
  aiTokensUsed: number;
  aiReviewSkipped: boolean;
}
