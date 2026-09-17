"use client";

import type { SafetyRating } from "@/lib/scanner/safety-rating";

/** One row of GET /api/v3/assets -- see that route for the exact shape. */
export interface AssetRow {
  host: string;
  scanCount: number;
  latestScanId: number;
  latestUrl: string;
  latestScannedAt: string;
  findingsCount: number;
  summary: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    info?: number;
  };
  safetyRating: SafetyRating;
  isPublic: boolean;
}

// Canonical relative-time formatter (see lib/ui/relative-time.ts).
export { formatRelativeTime } from "@/lib/ui/relative-time";
