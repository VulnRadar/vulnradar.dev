"use client";

import { useState } from "react";
import { IssueDetail } from "@/components/scanner/issue-detail";
import {
  DemoHero,
  DemoScanning,
  DemoError,
  DemoResultsHeader,
  DemoCTA,
  DemoInfo,
} from "@/components/demo";
import { ScanResultDetail } from "@/components/scanner/scan-result-detail";
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery";
import { API } from "@/lib/config/constants";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

export default function DemoPage() {
  const [status, setStatus] = useState<"idle" | "scanning" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [scansRemaining, setScansRemaining] = useState<number | null>(null);

  async function handleSelfScan() {
    setStatus("scanning");
    setResult(null);
    setError(null);
    setErrorDetails(null);
    setSelectedIssue(null);

    try {
      const siteUrl = window.location.origin;
      const res = await fetch(API.DEMO_SCAN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: siteUrl }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Scan failed");
        setErrorDetails(data.details || null);
        if (typeof data.remaining === "number")
          setScansRemaining(data.remaining);
        setStatus("error");
        return;
      }

      setResult(data);
      if (typeof data.remaining === "number") setScansRemaining(data.remaining);
      setStatus("done");
    } catch {
      setError("Something went wrong");
      setStatus("error");
    }
  }

  return (
    <>
      {/* Hero / Initial State */}
      {status === "idle" && (
        <>
          <DemoHero scansRemaining={scansRemaining} onScan={handleSelfScan} />
          <DemoInfo />
          <DemoCTA />
        </>
      )}

      {/* Scanning State */}
      {status === "scanning" && <DemoScanning />}

      {/* Error State */}
      {status === "error" && (
        <>
          <DemoError
            error={error || "An error occurred"}
            details={errorDetails || undefined}
            onRetry={() => setStatus("idle")}
          />
          <DemoCTA />
        </>
      )}

      {/* Results */}
      {status === "done" && result && (
        <>
          {selectedIssue ? (
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
              <IssueDetail
                issue={selectedIssue}
                onBack={() => setSelectedIssue(null)}
              />
            </div>
          ) : (
            <>
              <DemoResultsHeader
                result={result}
                onScanAgain={() => {
                  setStatus("idle");
                  setResult(null);
                }}
              />

              <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-8 flex flex-col gap-6">
                {/* Same unified renderer every scan surface uses, so the demo
                    shows the full modern result (verdict, SSL/DNS/ports/
                    software inventory panels when present, findings) instead of
                    the stale ad-hoc layout it used to. Subdomains are rendered
                    read-only from the cache the demo scan warmed: they were
                    fetched server-side if not already cached, and there is no
                    refresh control -- exactly one fetch per host. */}
                <ScanResultDetail
                  result={result}
                  onSelectIssue={setSelectedIssue}
                  subdomain={
                    <SubdomainDiscovery
                      url={result.url}
                      readOnly
                      cachedResult={result.subdomains ?? null}
                    />
                  }
                />
              </div>

              <DemoCTA />
            </>
          )}
        </>
      )}
    </>
  );
}
