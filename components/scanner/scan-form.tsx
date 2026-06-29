"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  ArrowRight,
  Zap,
  Globe,
  ListChecks,
  Check,
  X,
  Server,
  Mail,
  Database,
  Folder,
  Lock,
  Shield,
  Cookie,
  FileCode,
  Eye,
  Settings,
  Network,
  Cpu,
  KeyRound,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/ui/utils";
import type { Category, ScanStatus } from "@/lib/scanner/types";
import {
  getQueryParam,
  setQueryParam,
  setQueryParams,
} from "@/lib/ui/url-state";

export type ScanMode = "quick" | "deep" | "bulk";

export type ServiceProbe = "ssh" | "smtp" | "imap" | "pop3" | "ftp" | "mongodb";

export const DEFAULT_PROBE_PORTS: Record<ServiceProbe, number> = {
  ssh: 22,
  smtp: 25,
  imap: 143,
  pop3: 110,
  ftp: 21,
  mongodb: 27017,
};

interface ServiceProbeOption {
  id: ServiceProbe;
  label: string;
  defaultPort: number;
  altPorts: readonly number[];
  icon: React.ElementType;
}

const SERVICE_PROBES: readonly ServiceProbeOption[] = [
  {
    id: "ssh",
    label: "SSH",
    defaultPort: 22,
    altPorts: [2222, 222, 2200],
    icon: Lock,
  },
  {
    id: "smtp",
    label: "SMTP",
    defaultPort: 25,
    altPorts: [587, 465, 2525],
    icon: Mail,
  },
  {
    id: "imap",
    label: "IMAP",
    defaultPort: 143,
    altPorts: [993],
    icon: Mail,
  },
  {
    id: "pop3",
    label: "POP3",
    defaultPort: 110,
    altPorts: [995],
    icon: Mail,
  },
  {
    id: "ftp",
    label: "FTP",
    defaultPort: 21,
    altPorts: [990, 2121],
    icon: Folder,
  },
  {
    id: "mongodb",
    label: "MongoDB",
    defaultPort: 27017,
    altPorts: [27018, 27019],
    icon: Database,
  },
];

interface CheckFamily {
  id: Category;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  /** Categories that are auto-disabled when URL is plain HTTP */
  requiresTls?: boolean;
}

const CHECK_FAMILIES: readonly CheckFamily[] = [
  {
    id: "headers",
    label: "Security headers",
    shortLabel: "Headers",
    icon: Shield,
  },
  {
    id: "ssl",
    label: "SSL certificate",
    shortLabel: "SSL",
    icon: Lock,
    requiresTls: true,
  },
  {
    id: "tls",
    label: "TLS details",
    shortLabel: "TLS",
    icon: Lock,
    requiresTls: true,
  },
  {
    id: "cookies",
    label: "Cookie security",
    shortLabel: "Cookies",
    icon: Cookie,
  },
  {
    id: "content",
    label: "Content analysis",
    shortLabel: "Content",
    icon: FileCode,
  },
  {
    id: "information-disclosure",
    label: "Info disclosure",
    shortLabel: "Info",
    icon: Eye,
  },
  {
    id: "configuration",
    label: "Configuration",
    shortLabel: "Config",
    icon: Settings,
  },
  { id: "dns", label: "DNS records", shortLabel: "DNS", icon: Network },
  { id: "email", label: "Email security", shortLabel: "Email", icon: Mail },
  { id: "api", label: "API surface", shortLabel: "API", icon: Boxes },
  { id: "code", label: "Code (SAST)", shortLabel: "Code", icon: Cpu },
  {
    id: "secrets-extended",
    label: "Secrets",
    shortLabel: "Secrets",
    icon: KeyRound,
  },
];

export interface ScanFormProbe {
  id: ServiceProbe;
  port: number;
}

export interface ScanFormPayload {
  url: string;
  mode: ScanMode;
  scanners?: Category[];
  probes: ScanFormProbe[];
}

interface ScanFormProps {
  onScan: (payload: ScanFormPayload) => void;
  onBulkScan?: (urls: string[]) => void;
  bulkStatus?: "idle" | "scanning" | "done";
  bulkProgress?: { current: number; total: number };
  status: ScanStatus;
}

const DOMAIN_REGEX =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(\.[a-zA-Z]{2,})?(:\d+)?(\/.*)?$/;

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?::\d+)?(?:\/.*)?$/;

function normalizeInput(input: string): string {
  return input
    .trim()
    .replace(/^(?:https?|wss?|ftps?|sftp):\/\//i, "")
    .replace(/\/+$/, "");
}

function looksLikeDomain(input: string): boolean {
  if (!input) return false;
  const cleaned = normalizeInput(input);
  if (!cleaned) return false;
  if (!cleaned.includes(".")) return false;
  return DOMAIN_REGEX.test(cleaned);
}

function looksLikeIp(input: string): boolean {
  if (!input) return false;
  const cleaned = normalizeInput(input);
  return IPV4_REGEX.test(cleaned);
}

/**
 * Inspect the URL and decide which check families are auto-disabled.
 *
 *   http://example.com     -> no TLS, no SSL
 *   example.com (no scheme) -> assume https -> all on
 *   raw IPv4                -> no HTTP checks, probes only (set later)
 */
function autoDisableFamilies(rawUrl: string): Set<Category> {
  const disabled = new Set<Category>();
  if (/^http:\/\//i.test(rawUrl.trim())) {
    disabled.add("ssl");
    disabled.add("tls");
  }
  if (looksLikeIp(rawUrl)) {
    // Raw IPs: web checks (headers, ssl, tls, cookies, content, info,
    // configuration, code, secrets, api) all need a hostname + HTTP
    // context. Leave dns + email as best-effort.
    disabled.add("headers");
    disabled.add("ssl");
    disabled.add("tls");
    disabled.add("cookies");
    disabled.add("content");
    disabled.add("information-disclosure");
    disabled.add("configuration");
    disabled.add("code");
    disabled.add("secrets-extended");
    disabled.add("api");
  }
  return disabled;
}

function isProbeOnlyTarget(rawUrl: string): boolean {
  return looksLikeIp(rawUrl);
}

function parseModeFromQuery(raw: string | null): ScanMode {
  if (raw === "deep" || raw === "bulk") return raw;
  return "quick";
}

function parseProbesFromQuery(raw: string | null): ScanFormProbe[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      const [idPart, portPart] = entry.split(":");
      const id = idPart as ServiceProbe;
      if (!DEFAULT_PROBE_PORTS[id]) return null;
      const port = portPart ? parseInt(portPart, 10) : DEFAULT_PROBE_PORTS[id];
      const safePort =
        Number.isFinite(port) && port >= 1 && port <= 65535
          ? port
          : DEFAULT_PROBE_PORTS[id];
      return { id, port: safePort };
    })
    .filter((p): p is ScanFormProbe => p !== null);
}

function serializeProbesToQuery(probes: ScanFormProbe[]): string | null {
  if (probes.length === 0) return null;
  return probes.map((p) => `${p.id}:${p.port}`).join(",");
}

export function ScanForm({
  onScan,
  onBulkScan,
  bulkStatus = "idle",
  bulkProgress,
  status,
}: ScanFormProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ScanMode>(() =>
    parseModeFromQuery(getQueryParam("mode")),
  );
  const [probes, setProbes] = useState<ScanFormProbe[]>(() =>
    parseProbesFromQuery(getQueryParam("probes")),
  );
  const [enabledFamilies, setEnabledFamilies] = useState<Set<Category>>(
    () =>
      new Set(
        CHECK_FAMILIES.map((f) => f.id).filter(
          (id) => getQueryParam(`family_${id}`) !== "0",
        ),
      ),
  );
  const [scannersOpen, setScannersOpen] = useState(false);
  const [probesOpen, setProbesOpen] = useState(false);
  const [bulkUrls, setBulkUrls] = useState("");
  const [bulkError, setBulkError] = useState("");

  const isScanning = status === "scanning";
  const isBulkScanning = bulkStatus === "scanning";

  const autoDisabled = useMemo(() => autoDisableFamilies(url), [url]);
  const probeOnly = useMemo(() => isProbeOnlyTarget(url), [url]);
  const effectiveFamilies = useMemo(
    () =>
      CHECK_FAMILIES.filter(
        (f) => enabledFamilies.has(f.id) && !autoDisabled.has(f.id),
      ).length,
    [enabledFamilies, autoDisabled],
  );
  const totalFamilies = CHECK_FAMILIES.length;

  useEffect(() => {
    setQueryParams({
      mode: mode === "quick" ? null : mode,
      probes: serializeProbesToQuery(probes),
    });
    for (const family of CHECK_FAMILIES) {
      setQueryParam(
        `family_${family.id}`,
        enabledFamilies.has(family.id) ? null : "0",
      );
    }
  }, [mode, probes, enabledFamilies]);

  function toggleFamily(id: Category) {
    setEnabledFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProbe(id: ServiceProbe) {
    setProbes((prev) => {
      const existing = prev.find((p) => p.id === id);
      if (existing) {
        return prev.filter((p) => p.id !== id);
      }
      return [...prev, { id, port: DEFAULT_PROBE_PORTS[id] }];
    });
  }

  function setProbePort(id: ServiceProbe, port: number) {
    setProbes((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              port:
                Number.isFinite(port) && port >= 1 && port <= 65535
                  ? port
                  : DEFAULT_PROBE_PORTS[id],
            }
          : p,
      ),
    );
  }

  function enableAllFamilies() {
    setEnabledFamilies(new Set(CHECK_FAMILIES.map((f) => f.id)));
  }

  function resetAllFamilies() {
    setEnabledFamilies(new Set());
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!looksLikeDomain(url) && !looksLikeIp(url)) {
      setError("Enter a valid domain or IPv4 address.");
      return;
    }
    const familyList = CHECK_FAMILIES.map((f) => f.id).filter(
      (id) => enabledFamilies.has(id) && !autoDisabled.has(id),
    );
    const scanners =
      familyList.length === totalFamilies ? undefined : familyList;
    onScan({
      url: normalizeInput(url),
      mode,
      scanners,
      probes,
    });
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
    const invalid = lines.filter(
      (u) =>
        !u.match(/^https?:\/\//i) ||
        !looksLikeDomain(u.replace(/^https?:\/\//i, "")),
    );
    if (invalid.length > 0) {
      setBulkError(
        `Invalid URLs: ${invalid.slice(0, 2).join(", ")}${invalid.length > 2 ? "..." : ""}`,
      );
      return;
    }
    onBulkScan?.(lines);
  }

  const allFamiliesSelected = effectiveFamilies === totalFamilies;

  return (
    <div className="flex flex-col items-center gap-3 pt-1 sm:pt-2 w-full max-w-lg mx-auto">
      {/* Mode toggle — Quick / Deep / Bulk */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-muted/40 border border-border/60 w-full">
        {[
          { id: "quick" as const, label: "Quick", icon: Zap },
          { id: "deep" as const, label: "Deep", icon: Globe },
          { id: "bulk" as const, label: "Bulk", icon: ListChecks },
        ].map(({ id, label, icon: Icon }) => {
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              disabled={isScanning}
              className={cn(
                "flex items-center justify-center gap-1.5 flex-1 px-3 py-1 rounded text-xs font-medium border border-transparent transition-colors duration-200",
                active
                  ? "bg-background text-foreground shadow-sm border-border/60"
                  : "text-muted-foreground hover:text-foreground",
                isScanning && "opacity-50 cursor-not-allowed",
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          );
        })}
      </div>

      {/* URL input + Scan + Scanners + Probes */}
      <form
        onSubmit={handleSubmit}
        aria-hidden={mode === "bulk"}
        className={cn(
          "flex flex-col items-stretch gap-1.5 w-full transition-all duration-200",
          mode === "bulk"
            ? "pointer-events-none -translate-y-1 opacity-0 h-0 overflow-hidden"
            : "translate-y-0 opacity-100",
        )}
      >
        <label htmlFor="scan-url-input" className="sr-only">
          Domain, URL, or IPv4
        </label>
        <div className="flex items-stretch gap-1.5">
          <div className="relative flex-1 flex rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all overflow-hidden">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                id="scan-url-input"
                type="text"
                placeholder="example.com or 203.0.113.10"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError("");
                }}
                disabled={isScanning}
                className="pl-8 h-9 border-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                aria-label="Domain, URL, or IPv4"
                aria-invalid={!!error}
                aria-describedby={error ? "url-error" : undefined}
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={isScanning}
            size="sm"
            className="h-9 px-3.5 font-medium shrink-0 text-xs"
          >
            {isScanning ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Scanning
              </>
            ) : (
              <>
                Scan
                <ArrowRight className="ml-1.5 h-3 w-3" />
              </>
            )}
          </Button>

          <Popover open={scannersOpen} onOpenChange={setScannersOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isScanning}
                className={cn(
                  "h-9 px-2.5 bg-transparent shrink-0 gap-1 text-xs",
                  !allFamiliesSelected && "border-primary/40 text-primary",
                )}
                aria-label="Check families"
                title="Choose which check families to run"
              >
                <Shield className="h-3 w-3" />
                <span className="font-mono tabular-nums">
                  {allFamiliesSelected
                    ? "All"
                    : `${effectiveFamilies}/${totalFamilies}`}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-72 p-0 overflow-hidden"
            >
              <div className="px-3 pt-3 pb-2 border-b border-border/60 bg-card/40">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <h3 className="text-xs font-semibold text-foreground">
                    Check families
                  </h3>
                  <button
                    type="button"
                    onClick={
                      effectiveFamilies === 0
                        ? enableAllFamilies
                        : resetAllFamilies
                    }
                    className="text-[11px] font-medium text-primary hover:bg-primary/10 px-1.5 py-0.5 rounded transition-colors"
                  >
                    {effectiveFamilies === 0 ? "Enable all" : "Disable all"}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {effectiveFamilies}/{totalFamilies} enabled
                  {probeOnly && " · web checks disabled for raw IP"}
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto p-1 space-y-0.5">
                {CHECK_FAMILIES.map(
                  ({ id, label, shortLabel, icon: Icon, requiresTls }) => {
                    const autoOff = requiresTls && autoDisabled.has(id);
                    const active = !autoOff && enabledFamilies.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleFamily(id)}
                        disabled={isScanning}
                        aria-pressed={active}
                        className={cn(
                          "group relative w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors",
                          active && "bg-primary/5 hover:bg-primary/10",
                          !active && !autoOff && "hover:bg-muted/60",
                          autoOff && "opacity-40 cursor-not-allowed",
                          isScanning && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-3 w-3 shrink-0",
                            active ? "text-primary" : "text-muted-foreground",
                            autoOff && "line-through",
                          )}
                        />
                        <span
                          className={cn(
                            "text-xs font-medium",
                            active
                              ? "text-foreground"
                              : "text-muted-foreground",
                            autoOff && "line-through",
                          )}
                        >
                          {shortLabel}
                          <span className="text-muted-foreground/70 font-normal ml-1 hidden sm:inline">
                            {label.replace(shortLabel, "").trim()}
                          </span>
                        </span>
                        <div
                          className={cn(
                            "ml-auto shrink-0 flex items-center justify-center w-3 h-3 rounded border",
                            active
                              ? "bg-primary border-primary text-primary-foreground"
                              : "bg-transparent border-border/80 group-hover:border-muted-foreground/50",
                            autoOff && "opacity-30",
                          )}
                        >
                          {active && (
                            <Check className="h-2 w-2" strokeWidth={3} />
                          )}
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={probesOpen} onOpenChange={setProbesOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isScanning}
                className={cn(
                  "h-9 px-2.5 bg-transparent shrink-0 gap-1 text-xs",
                  probes.length > 0 && "border-primary/40 text-primary",
                )}
                aria-label="Service probes"
                title="Probe TCP services on the hostname"
              >
                <Server className="h-3 w-3" />
                <span className="font-mono tabular-nums">
                  {probes.length}/6
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-72 p-0 overflow-hidden"
            >
              <div className="px-3 pt-3 pb-2 border-b border-border/60 bg-card/40">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <h3 className="text-xs font-semibold text-foreground">
                    Service probes
                  </h3>
                  <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                    {probes.length}/6
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Open a TCP socket per service, read the greeting.
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto p-1 space-y-1">
                {SERVICE_PROBES.map(
                  ({ id, label, defaultPort, altPorts, icon: Icon }) => {
                    const probe = probes.find((p) => p.id === id);
                    const active = !!probe;
                    return (
                      <div
                        key={id}
                        className={cn(
                          "rounded border transition-colors",
                          active
                            ? "bg-primary/5 border-primary/40"
                            : "bg-muted/20 border-border/60 hover:border-border",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleProbe(id)}
                          disabled={isScanning}
                          aria-pressed={active}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
                        >
                          <Icon
                            className={cn(
                              "h-3 w-3 shrink-0",
                              active ? "text-primary" : "text-muted-foreground",
                            )}
                          />
                          <span
                            className={cn(
                              "text-xs font-medium",
                              active
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {label}
                          </span>
                          <span className="text-[10px] text-muted-foreground/70 font-mono ml-auto mr-1">
                            :{defaultPort}
                          </span>
                          <div
                            className={cn(
                              "shrink-0 flex items-center justify-center w-3 h-3 rounded border",
                              active
                                ? "bg-primary border-primary text-primary-foreground"
                                : "bg-transparent border-border/80",
                            )}
                          >
                            {active && (
                              <Check className="h-2 w-2" strokeWidth={3} />
                            )}
                          </div>
                        </button>
                        {active && probe && (
                          <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-0.5 border-t border-primary/20 mt-0.5">
                            <label
                              htmlFor={`probe-port-${id}`}
                              className="text-[10px] text-muted-foreground font-mono shrink-0"
                            >
                              Port
                            </label>
                            <Input
                              id={`probe-port-${id}`}
                              type="number"
                              min={1}
                              max={65535}
                              value={probe.port}
                              onChange={(e) =>
                                setProbePort(id, parseInt(e.target.value, 10))
                              }
                              disabled={isScanning}
                              className="h-6 px-1.5 text-[11px] font-mono tabular-nums w-16 bg-background"
                              aria-label={`${label} port`}
                            />
                            <div className="flex items-center gap-1 overflow-x-auto">
                              {[defaultPort, ...altPorts]
                                .filter((p, i, arr) => arr.indexOf(p) === i)
                                .slice(0, 4)
                                .map((alt) => (
                                  <button
                                    key={alt}
                                    type="button"
                                    onClick={() => setProbePort(id, alt)}
                                    disabled={isScanning}
                                    className={cn(
                                      "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums transition-colors",
                                      probe.port === alt
                                        ? "bg-primary/20 text-primary"
                                        : "bg-muted/60 text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    {alt}
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {error && (
          <p
            id="url-error"
            className="text-xs text-destructive flex items-center gap-1.5 justify-center"
            role="alert"
          >
            <X className="h-3 w-3 shrink-0" />
            {error}
          </p>
        )}

        <p className="text-[10px] text-muted-foreground leading-snug text-center">
          {probeOnly
            ? "Raw IP detected — only DNS + service probes will run."
            : "Scans the single HTTPS endpoint for vulnerabilities."}
        </p>
      </form>

      {/* Bulk form */}
      <form
        onSubmit={handleBulkSubmit}
        aria-hidden={mode !== "bulk"}
        className={cn(
          "flex flex-col gap-2 w-full transition-all duration-200",
          mode !== "bulk"
            ? "pointer-events-none -translate-y-1 opacity-0 h-0 overflow-hidden"
            : "translate-y-0 opacity-100",
        )}
      >
        <label className="text-xs font-medium text-muted-foreground text-center">
          Targets (up to 10 URLs, one per line)
        </label>
        <div className="rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-muted/30">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ListChecks className="h-3 w-3" />
              <span className="font-mono font-medium tabular-nums">
                {bulkUrls.split("\n").filter((u) => u.trim()).length}/10
              </span>
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
            rows={5}
            disabled={isBulkScanning}
            className="w-full bg-transparent px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none font-mono disabled:opacity-50"
            aria-label="URLs to bulk scan, one per line"
          />
        </div>

        {isBulkScanning && bulkProgress && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Scanning URL {bulkProgress.current} of {bulkProgress.total}
              </span>
              <span className="text-foreground font-medium tabular-nums">
                {Math.round((bulkProgress.current / bulkProgress.total) * 100)}%
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
            size="sm"
            className="h-9 px-4 font-medium min-w-[140px] text-xs"
          >
            {isBulkScanning ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Scanning{" "}
                {bulkProgress
                  ? `${bulkProgress.current}/${bulkProgress.total}`
                  : "..."}
              </>
            ) : (
              <>
                <ListChecks className="mr-1.5 h-3 w-3" />
                Start bulk scan
              </>
            )}
          </Button>
        </div>

        {bulkError && (
          <p
            className="text-xs text-destructive flex items-center gap-1.5 justify-center"
            role="alert"
          >
            <X className="h-3 w-3 shrink-0" />
            {bulkError}
          </p>
        )}
      </form>
    </div>
  );
}

export { SERVICE_PROBES, parseProbesFromQuery, serializeProbesToQuery };
