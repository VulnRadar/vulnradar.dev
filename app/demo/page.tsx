"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { API } from "@/lib/config/client-constants";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

export default function DemoPage() {
  return (
    <Suspense fallback={<DemoScanning />}>
      <DemoPageContent />
    </Suspense>
  );
}

function DemoPageContent() {
  const searchParams = useSearchParams();
  // ?url= is how another page hands this one a target. app/host/[hostname]
  // links here with the host it is reporting on, whose CTA used to say
  // "Scan example.com now" and then scan this deployment instead, because
  // handleSelfScan had no target and fell back to window.location.origin.
  const requestedTarget = searchParams.get("url");
  const autoScanned = useRef(false);
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

  async function handleSelfScan(requestedUrl?: string) {
    setStatus("scanning");
    setResult(null);
    setError(null);
    setErrorDetails(null);
    setSelectedIssue(null);

    try {
      // No argument keeps the original behaviour: scan this deployment, which
      // is the page's opening pitch. A supplied value is the visitor's own
      // site. The scheme is prepended the same way the scan API documents it,
      // so "example.com" works rather than failing URL parsing server-side.
      const trimmed = requestedUrl?.trim();
      const siteUrl = trimmed
        ? /^https?:\/\//i.test(trimmed)
          ? trimmed
          : `https://${trimmed}`
        : window.location.origin;
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

  useEffect(() => {
    if (autoScanned.current) return;
    const target = requestedTarget?.trim();
    if (!target) return;
    autoScanned.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runs the scan the arriving link asked for; setStatus fires inside handleSelfScan, not synchronously here, and the ref guard makes it run once
    handleSelfScan(target);
  }, [requestedTarget]);

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

              {/* pt was missing, so the verdict card sat flush against the
                  header's bottom rule with no breathing room at all: the one
                  spacing bug on this page that reads instantly as unfinished. */}
              <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-8 pt-6 sm:px-6 sm:pt-8">
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
