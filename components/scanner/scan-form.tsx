"use client";

import React from "react";
import { useState } from "react";
import {
  Shield,
  Loader2,
  Search,
  ArrowRight,
  Zap,
  Globe,
  SlidersHorizontal,
  Check,
  Lock,
  Cookie,
  FileCode,
  Eye,
  Settings,
  ChevronDown,
  ListChecks,
  ListFilter,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import type { Category, ScanStatus } from "@/lib/scanner/types";
import {
  SCAN_PROTOCOLS,
  type ScanProtocol,
  isHttpProtocol,
} from "@/lib/scanner/protocols";
import { Cpu, KeyRound, Boxes, MailCheck, Network } from "lucide-react";

export type ScanMode = "quick" | "deep" | "bulk";

// Scanner categories shown in the protocol selector. Mirrors the 12
// categories in lib/scanner/types.ts (Category). Each entry maps to one
// of those categories; the user picks which families of checks to run.
export const SCANNER_CATEGORIES = [
  {
    id: "headers",
    label: "Security Headers",
    icon: Shield,
    description:
      "HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy",
  },
  {
    id: "ssl",
    label: "SSL / TLS",
    icon: Lock,
    description: "Certificate validity, protocol version, chain verification",
  },
  {
    id: "cookies",
    label: "Cookie Security",
    icon: Cookie,
    description: "Secure, HttpOnly, SameSite flags",
  },
  {
    id: "content",
    label: "Content Analysis",
    icon: FileCode,
    description: "Mixed content, DOM XSS sinks, iframes, reverse tabnabbing",
  },
  {
    id: "information-disclosure",
    label: "Info Disclosure",
    icon: Eye,
    description:
      "Server headers, source maps, secrets, private IPs, debug info",
  },
  {
    id: "configuration",
    label: "Configuration",
    icon: Settings,
    description: "robots.txt, security.txt, open redirects",
  },
  {
    id: "dns",
    label: "DNS Records",
    icon: Network,
    description: "A/AAAA/MX/CAA/SOA/NS recon",
  },
  {
    id: "email",
    label: "Email Security",
    icon: MailCheck,
    description: "SPF, DMARC, DKIM, DNSSEC, MTA-STS, TLS-RPT, BIMI",
  },
  {
    id: "tls",
    label: "TLS Details",
    icon: Lock,
    description: "Cipher suites, OCSP stapling, CT logs, key sizes",
  },
  {
    id: "code",
    label: "Code (SAST)",
    icon: Cpu,
    description:
      "eval / innerHTML / SSTI / SQLi / XSS sinks / hardcoded secrets",
  },
  {
    id: "secrets-extended",
    label: "Secrets",
    icon: KeyRound,
    description: "API keys, JWTs, private keys, connection strings, PII",
  },
  {
    id: "api",
    label: "API Surface",
    icon: Boxes,
    description: "GraphQL, REST, OpenAPI/Swagger, JSONP, rate limiting",
  },
] as const satisfies readonly {
  id: Category;
  label: string;
  icon: typeof Shield;
  description: string;
}[];

export type ScannerCategoryId = (typeof SCANNER_CATEGORIES)[number]["id"];

const ALL_CATEGORY_IDS = SCANNER_CATEGORIES.map((c) => c.id);

interface ScanFormProps {
  onScan: (
    url: string,
    mode?: ScanMode,
    scanners?: string[],
    protocol?: ScanProtocol,
  ) => void;
  onBulkScan?: (urls: string[]) => void;
  bulkStatus?: "idle" | "scanning" | "done";
  bulkProgress?: { current: number; total: number };
  status: ScanStatus;
}

const MODE_DESCRIPTIONS: Record<ScanMode, (proto: string) => string> = {
  quick: (proto) =>
    `Scans the single ${proto.replace("://", "").toUpperCase()} endpoint for vulnerabilities.`,
  deep: () => "Crawls the site to find internal pages, then scans each one.",
  bulk: () =>
    "Scan up to 10 URLs at once. Each URL counts toward your daily limit.",
};

export function ScanForm({
  onScan,
  onBulkScan,
  bulkStatus = "idle",
  bulkProgress,
  status,
}: ScanFormProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ScanMode>("quick");
  const [protocol, setProtocol] = useState<ScanProtocol>("https://");
  const [selectedScanners, setSelectedScanners] = useState<
    Set<ScannerCategoryId>
  >(new Set(ALL_CATEGORY_IDS));
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [bulkUrls, setBulkUrls] = useState("");
  const [bulkError, setBulkError] = useState("");

  // Get available categories for current protocol
  const protocolConfig = SCAN_PROTOCOLS.find((p) => p.value === protocol);
  const availableCategories: readonly ScannerCategoryId[] =
    protocolConfig?.categories ?? [];

  const allSelected = selectedScanners.size === ALL_CATEGORY_IDS.length;
  const noneSelected = selectedScanners.size === 0;

  function toggleScanner(id: ScannerCategoryId) {
    setSelectedScanners((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelectedScanners(new Set());
    else setSelectedScanners(new Set(ALL_CATEGORY_IDS));
  }

  function validate(input: string): boolean {
    if (!input.trim()) {
      setError("Please enter a domain or URL");
      return false;
    }
    const cleaned = input.replace(/^(?:https?|wss?|ftps?):\/\//i, "").trim();
    if (!cleaned) {
      setError("Please enter a valid domain");
      return false;
    }
    const domainRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(\.[a-zA-Z]{2,})?(:\d+)?(\/.*)?$/;
    if (!domainRegex.test(cleaned)) {
      setError("Please enter a valid domain (e.g., example.com)");
      return false;
    }
    const validScanners = Array.from(selectedScanners).filter((s) =>
      availableCategories.includes(s),
    );
    if (validScanners.length === 0) {
      setError(
        `No selected scanners available for ${protocol.replace("://", "").toUpperCase()} protocol`,
      );
      return false;
    }
    setError("");
    return true;
  }

  function buildFullUrl(input: string): string {
    const cleaned = input.replace(/^(?:https?|wss?|ftps?):\/\//i, "").trim();
    return protocol + cleaned;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validate(url)) {
      const fullUrl = buildFullUrl(url);
      const validScanners = Array.from(selectedScanners).filter((s) =>
        availableCategories.includes(s),
      );
      const scanners =
        validScanners.length === availableCategories.length
          ? undefined
          : validScanners;
      onScan(fullUrl, mode, scanners, protocol);
    }
  }

  function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBulkError("");
    const lines = bulkUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setBulkError("Enter at least one URL.");
      return;
    }
    if (lines.length > 10) {
      setBulkError("Maximum 10 URLs per bulk scan.");
      return;
    }
    const invalid = lines.filter((u) => {
      try {
        new URL(u);
        return false;
      } catch {
        return true;
      }
    });
    if (invalid.length > 0) {
      setBulkError(
        `Invalid URLs: ${invalid.slice(0, 2).join(", ")}${invalid.length > 2 ? "..." : ""}`,
      );
      return;
    }
    onBulkScan?.(lines);
  }

  const isScanning = status === "scanning";
  const isBulkScanning = bulkStatus === "scanning";
  const protoLabel = protocol.replace("://", "").toUpperCase();

  return (
    <div className="flex flex-col gap-8 pt-6">
      {/* Section header */}
      <div>
        <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
          Scanner
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">
          Run a scan
        </h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-xl text-pretty">
          {MODE_DESCRIPTIONS[mode](protocol)} {TOTAL_CHECKS_LABEL} checks total.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border/60 w-full sm:w-fit">
        {[
          { id: "quick" as const, label: "Quick", icon: Zap },
          { id: "deep" as const, label: "Deep", icon: Globe },
          { id: "bulk" as const, label: "Bulk", icon: ListChecks },
        ].map(({ id, label, icon: Icon }) => {
          const disabled = id === "deep" && !isHttpProtocol(protocol);
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => !disabled && setMode(id)}
              disabled={disabled}
              title={
                disabled
                  ? "Deep crawl only available for HTTP/HTTPS"
                  : undefined
              }
              className={cn(
                "flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-3.5 py-1.5 rounded-md text-sm font-medium transition-all",
                active
                  ? "bg-background text-foreground shadow-sm border border-border/60"
                  : "text-muted-foreground hover:text-foreground",
                disabled &&
                  "opacity-50 cursor-not-allowed hover:text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Single URL form (Quick / Deep) */}
      {mode !== "bulk" && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 w-full max-w-2xl"
        >
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 flex rounded-lg border border-border bg-card focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all overflow-hidden">
              {/* Protocol dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={isScanning}
                    className={cn(
                      "flex items-center gap-1.5 px-3 h-11 border-r border-border bg-muted/30 text-xs font-mono font-semibold text-foreground hover:bg-muted/50 transition-colors shrink-0 min-w-[64px]",
                      isScanning && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {protocol.replace("://", "")}
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 p-1">
                  {SCAN_PROTOCOLS.map((p) => {
                    const selected = protocol === p.value;
                    return (
                      <DropdownMenuItem
                        key={p.value}
                        onClick={() => {
                          setProtocol(p.value);
                          const protoCfg = SCAN_PROTOCOLS.find(
                            (pr) => pr.value === p.value,
                          );
                          if (protoCfg) {
                            setSelectedScanners(
                              new Set(
                                protoCfg.categories.filter((c) =>
                                  ALL_CATEGORY_IDS.includes(c),
                                ),
                              ),
                            );
                          }
                          if (p.value !== "https://" && p.value !== "http://") {
                            setMode("quick");
                          }
                        }}
                        className={cn(
                          "flex flex-col items-start gap-0.5 py-2 px-2.5 cursor-pointer rounded-sm",
                          selected
                            ? "bg-primary/10 text-foreground"
                            : "hover:bg-muted/60 text-foreground",
                        )}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className="font-mono font-semibold text-sm">
                            {p.value}
                          </span>
                          {selected && (
                            <Check className="h-3.5 w-3.5 text-primary ml-auto" />
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground leading-tight">
                          {p.description}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* URL input */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder="example.com"
                  value={url}
                  onChange={(e) => {
                    const val = e.target.value.replace(
                      /^(?:https?|wss?|ftps?):\/\//i,
                      "",
                    );
                    setUrl(val);
                    if (error) setError("");
                  }}
                  disabled={isScanning}
                  className="pl-9 h-11 border-0 bg-transparent text-foreground placeholder:text-muted-foreground text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  aria-label="Domain or URL to scan"
                  aria-invalid={!!error}
                  aria-describedby={error ? "url-error" : undefined}
                />
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              <Button
                type="submit"
                disabled={isScanning || noneSelected}
                size="lg"
                className="h-11 px-6 font-medium min-w-[120px]"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning
                  </>
                ) : (
                  <>
                    Scan
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={isScanning}
                    className={cn(
                      "h-11 px-3 bg-transparent shrink-0",
                      !allSelected && "border-primary/40 text-primary",
                    )}
                    aria-label="Select scanners"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    <span className="hidden sm:inline ml-2 text-xs font-mono tabular-nums">
                      {allSelected
                        ? "All"
                        : `${selectedScanners.size}/${ALL_CATEGORY_IDS.length}`}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-foreground">
                        Select scanners
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {availableCategories.length} available for {protoLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-xs font-medium text-primary hover:underline shrink-0"
                    >
                      {allSelected ? "Clear" : "Select all"}
                    </button>
                  </div>

                  <div className="p-1.5 max-h-80 overflow-y-auto">
                    {SCANNER_CATEGORIES.map(
                      ({ id, label, icon: Icon, description }) => {
                        const checked = selectedScanners.has(id);
                        const isAvailable = availableCategories.includes(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => isAvailable && toggleScanner(id)}
                            disabled={!isAvailable}
                            className={cn(
                              "w-full flex items-start gap-3 px-2.5 py-2.5 rounded-md text-left transition-colors",
                              !isAvailable && "opacity-40 cursor-not-allowed",
                              isAvailable && checked && "bg-primary/10",
                              isAvailable && !checked && "hover:bg-muted/60",
                            )}
                          >
                            <div
                              className={cn(
                                "flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-colors",
                                isAvailable && checked
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted/60 text-muted-foreground",
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    "text-sm font-medium",
                                    isAvailable
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {label}
                                </span>
                                {!isAvailable && (
                                  <span className="text-[9px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase tracking-wider">
                                    N/A
                                  </span>
                                )}
                                {isAvailable && checked && (
                                  <Check className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                                {description}
                              </p>
                            </div>
                          </button>
                        );
                      },
                    )}
                  </div>

                  <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {
                        Array.from(selectedScanners).filter((s) =>
                          availableCategories.includes(s),
                        ).length
                      }{" "}
                      of {availableCategories.length} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectorOpen(false)}
                      className="text-primary font-medium hover:underline"
                    >
                      Done
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {error && (
            <p
              id="url-error"
              className="text-sm text-destructive flex items-center gap-2"
              role="alert"
            >
              <X className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </form>
      )}

      {/* Bulk scan form */}
      {mode === "bulk" && (
        <form
          onSubmit={handleBulkSubmit}
          className="flex flex-col gap-3 w-full max-w-2xl"
        >
          <div className="rounded-lg border border-border bg-card focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ListFilter className="h-3.5 w-3.5" />
                <span className="font-mono font-medium tabular-nums">
                  {bulkUrls.split("\n").filter((u) => u.trim()).length}/10
                </span>
                <span>URLs · one per line</span>
              </div>
              {bulkUrls && (
                <button
                  type="button"
                  onClick={() => setBulkUrls("")}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
            <textarea
              placeholder={
                "https://example.com\nhttps://another-site.com\nhttps://third-site.com"
              }
              value={bulkUrls}
              onChange={(e) => {
                setBulkUrls(e.target.value);
                if (bulkError) setBulkError("");
              }}
              rows={6}
              disabled={isBulkScanning}
              className="w-full bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none font-mono disabled:opacity-50"
              aria-label="URLs to bulk scan, one per line"
            />
          </div>

          {isBulkScanning && bulkProgress && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Scanning URL {bulkProgress.current} of {bulkProgress.total}
                </span>
                <span className="text-foreground font-medium tabular-nums">
                  {Math.round(
                    (bulkProgress.current / bulkProgress.total) * 100,
                  )}
                  %
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
                  style={{
                    width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={isBulkScanning || !bulkUrls.trim()}
              size="lg"
              className="h-11 px-6 font-medium min-w-[160px]"
            >
              {isBulkScanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning{" "}
                  {bulkProgress
                    ? `${bulkProgress.current}/${bulkProgress.total}`
                    : "..."}
                </>
              ) : (
                <>
                  <ListChecks className="mr-2 h-4 w-4" />
                  Start bulk scan
                </>
              )}
            </Button>
          </div>

          {bulkError && (
            <p
              className="text-sm text-destructive flex items-center gap-2"
              role="alert"
            >
              <X className="h-3.5 w-3.5 shrink-0" />
              {bulkError}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
