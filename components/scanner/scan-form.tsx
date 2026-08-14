"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Search,
  ArrowRight,
  Zap,
  Globe,
  ListChecks,
  Check,
  X,
  Plug,
  ListFilter,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import {
  InlineAuthForm,
  type InlineAuthFormHandle,
  type InlineAuthValue,
} from "@/components/scanner/inline-auth-form";
import { BULK_SCAN_CLIENT_URL_LIMIT } from "@/lib/config/constants";
export type ScanMode = "quick" | "deep" | "bulk";
export type { InlineAuthValue };

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
}

const SERVICE_PROBES: readonly ServiceProbeOption[] = [
  { id: "ssh", label: "SSH", defaultPort: 22, altPorts: [2222, 222, 2200] },
  { id: "smtp", label: "SMTP", defaultPort: 25, altPorts: [587, 465, 2525] },
  { id: "imap", label: "IMAP", defaultPort: 143, altPorts: [993] },
  { id: "pop3", label: "POP3", defaultPort: 110, altPorts: [995] },
  { id: "ftp", label: "FTP", defaultPort: 21, altPorts: [990, 2121] },
  {
    id: "mongodb",
    label: "MongoDB",
    defaultPort: 27017,
    altPorts: [27018, 27019],
  },
];

interface CheckFamily {
  id: Category;
  label: string;
  shortLabel: string;
  /** Small subheading the popover groups this row under. Consecutive
   *  entries sharing a group render one heading, not one per row. */
  group: string;
  /** Categories that are auto-disabled when URL is plain HTTP */
  requiresTls?: boolean;
}

const CHECK_FAMILIES: readonly CheckFamily[] = [
  {
    id: "headers",
    label: "Security headers",
    shortLabel: "Headers",
    group: "Transport",
  },
  {
    id: "ssl",
    label: "SSL certificate",
    shortLabel: "SSL",
    group: "Transport",
    requiresTls: true,
  },
  {
    id: "tls",
    label: "TLS details",
    shortLabel: "TLS",
    group: "Transport",
    requiresTls: true,
  },
  {
    id: "cookies",
    label: "Cookie security",
    shortLabel: "Cookies",
    group: "Transport",
  },
  {
    id: "content",
    label: "Content analysis",
    shortLabel: "Content",
    group: "Content & config",
  },
  {
    id: "information-disclosure",
    label: "Info disclosure",
    shortLabel: "Info",
    group: "Content & config",
  },
  {
    id: "configuration",
    label: "Configuration",
    shortLabel: "Config",
    group: "Content & config",
  },
  { id: "dns", label: "DNS records", shortLabel: "DNS", group: "Network" },
  {
    id: "email",
    label: "Email security",
    shortLabel: "Email",
    group: "Network",
  },
  { id: "api", label: "API surface", shortLabel: "API", group: "Network" },
  {
    id: "code",
    label: "Code (SAST)",
    shortLabel: "Code",
    group: "Code & supply chain",
  },
  {
    id: "secrets-extended",
    label: "Secrets",
    shortLabel: "Secrets",
    group: "Code & supply chain",
  },
  {
    id: "vibe-code",
    label: "AI code patterns",
    shortLabel: "AI code",
    group: "Code & supply chain",
  },
  {
    id: "client-side",
    label: "Client-side JS security",
    shortLabel: "Client-side",
    group: "Code & supply chain",
  },
  {
    id: "supply-chain",
    label: "Supply chain artifacts",
    shortLabel: "Supply chain",
    group: "Code & supply chain",
  },
  {
    id: "host-validation",
    label: "Host validation checks",
    shortLabel: "Host validation",
    group: "Code & supply chain",
  },
  {
    id: "reputation",
    label: "Threat reputation",
    shortLabel: "Reputation",
    group: "Network",
  },
  {
    id: "active-probes",
    label: "Reflected input (XSS) probe",
    shortLabel: "Active probing",
    group: "Active probing (writes to target)",
  },
];

/** Categories that must never be on by default: unlike every other check
 *  family, these submit real requests to the target rather than only
 *  reading its responses. Excluded from "Enable all" and from the initial
 *  checked state, and only ever sent to the API as an explicit inclusion
 *  in `scanners`, never implied by an omitted filter. */
const OPT_IN_FAMILIES = new Set<Category>(["active-probes"]);

export interface ScanFormProbe {
  id: ServiceProbe;
  port: number;
}

export interface ScanFormPayload {
  url: string;
  mode: ScanMode;
  scanners?: Category[];
  probes: ScanFormProbe[];
  /** Ephemeral login material for this one scan, present only when the
   *  "Sign in first" section is open and filled in. See
   *  components/scanner/inline-auth-form.tsx. */
  auth?: InlineAuthValue;
  /** From the "Keep this scan private" toggle below. A real submit through
   *  this form always sets this (the toggle's current value, itself seeded
   *  from the account default) -- it's optional here only so a caller that
   *  re-triggers a scan without going through the form (resuming a
   *  ?scan=id URL, "scan this subdomain") can omit it and let the API's
   *  own account-default fallback decide. See lib/scanner/scan-privacy.ts. */
  isPublic?: boolean;
}

interface ScanFormProps {
  onScan: (payload: ScanFormPayload) => void;
  onBulkScan?: (urls: string[], isPublic: boolean) => void;
  bulkStatus?: "idle" | "scanning" | "done";
  bulkProgress?: { current: number; total: number };
  status: ScanStatus;
  /** Account-level "scans are private by default" setting (Profile ->
   *  Privacy, see components/profile/tabs/profile-privacy-tab.tsx). Seeds
   *  the toggle below; once someone clicks it by hand, a later change to
   *  this prop (e.g. auth finishing its fetch after this form already
   *  mounted) stops overwriting their choice. */
  defaultPrivate?: boolean;
}

/**
 * Client-side cap on a bulk run. Deliberately independent of the
 * server-enforced MAX_URLS_BULK setting because this form fans out one
 * request per URL instead of hitting the batch endpoint.
 */
const BULK_URL_LIMIT = BULK_SCAN_CLIENT_URL_LIMIT;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  defaultPrivate,
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
        CHECK_FAMILIES.map((f) => f.id).filter((id) =>
          OPT_IN_FAMILIES.has(id)
            ? getQueryParam(`family_${id}`) === "1"
            : getQueryParam(`family_${id}`) !== "0",
        ),
      ),
  );
  const [scannersOpen, setScannersOpen] = useState(false);
  const [probesOpen, setProbesOpen] = useState(false);

  // Both popovers are Radix Popover.Content, which is `position: fixed`
  // and re-runs its Floating UI position calculation on every scroll
  // frame to stay anchored to its trigger button. That's fine on desktop,
  // but on iOS Safari a fixed element repositioning itself synchronously
  // during momentum scrolling forces layout work onto the main thread on
  // every frame, which is what actually causes the page to visibly hitch
  // while scrolling with either panel open. Close on scroll instead of
  // fighting that: once the user is actually scrolling, tracking the
  // trigger's position isn't useful anyway.
  useEffect(() => {
    if (!scannersOpen && !probesOpen) return;
    function handleScroll() {
      setScannersOpen(false);
      setProbesOpen(false);
    }
    window.addEventListener("scroll", handleScroll, {
      passive: true,
      capture: true,
    });
    return () =>
      window.removeEventListener("scroll", handleScroll, { capture: true });
  }, [scannersOpen, probesOpen]);
  const [bulkUrls, setBulkUrls] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [authValue, setAuthValue] = useState<InlineAuthValue | null>(null);
  const authFormRef = useRef<InlineAuthFormHandle>(null);

  // "Keep this scan private" -- seeded from the account default, but once
  // someone actually clicks it, their choice sticks even if `defaultPrivate`
  // changes underneath (e.g. auth finishes loading a beat after mount).
  const [keepPrivate, setKeepPrivate] = useState(!!defaultPrivate);
  const userTouchedPrivacyRef = useRef(false);
  useEffect(() => {
    if (!userTouchedPrivacyRef.current) setKeepPrivate(!!defaultPrivate);
  }, [defaultPrivate]);

  const isScanning = status === "scanning";
  const isBulkScanning = bulkStatus === "scanning";

  useEffect(() => {
    // Authenticated scanning is single-URL only (see
    // app/api/v3/scan/authenticated/route.ts), so it has no business
    // living on past a switch to bulk mode. Collapsing wipes every field,
    // not just the parent's copy of the built payload.
    if (mode === "bulk") authFormRef.current?.reset();
  }, [mode]);

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
  const defaultFamilyCount = CHECK_FAMILIES.filter(
    (f) => !OPT_IN_FAMILIES.has(f.id),
  ).length;

  useEffect(() => {
    // scanner: always set ?mode=... so the URL reflects the current
    // scan mode. Previously we omitted the param when mode === "quick"
    // (the default), but the user wants the URL to be self-describing:
    // even the default state should be explicit in the URL.
    setQueryParams({
      mode,
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
    setEnabledFamilies(
      new Set(
        CHECK_FAMILIES.map((f) => f.id).filter(
          (id) => !OPT_IN_FAMILIES.has(id),
        ),
      ),
    );
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
    // Omitting `scanners` means "run every default category" server-side
    // (see async-checks.ts's buildBranches), which never includes an
    // OPT_IN_FAMILIES member. So this can only take the shortcut of
    // omitting the filter when every non-opt-in family is selected AND no
    // opt-in family is -- if active-probes is checked, the explicit list
    // is the only way to actually tell the server to run it.
    const includesOptIn = familyList.some((id) => OPT_IN_FAMILIES.has(id));
    const scanners =
      !includesOptIn && familyList.length === defaultFamilyCount
        ? undefined
        : familyList;
    onScan({
      url: normalizeInput(url),
      mode,
      scanners,
      probes,
      auth: authValue ?? undefined,
      isPublic: !keepPrivate,
    });
    // The one request this login material was for has just been built and
    // handed off above. Wipe it immediately: nothing here survives a
    // submit, successful or not.
    authFormRef.current?.reset();
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
    if (lines.length > BULK_URL_LIMIT) {
      setBulkError(
        `${lines.length} URLs entered. A bulk run takes at most ${BULK_URL_LIMIT}.`,
      );
      return;
    }
    const invalid = lines.filter(
      (u) =>
        !u.match(/^https?:\/\//i) ||
        !looksLikeDomain(u.replace(/^https?:\/\//i, "")),
    );
    if (invalid.length > 0) {
      setBulkError(
        `Every line needs a full URL starting with http:// or https://. Fix: ${invalid.slice(0, 2).join(", ")}${invalid.length > 2 ? " and others" : ""}`,
      );
      return;
    }
    onBulkScan?.(lines, !keepPrivate);
  }

  const allFamiliesSelected = effectiveFamilies === totalFamilies;
  const trimmedUrl = url.trim();
  const isHttpScheme = /^http:\/\//i.test(trimmedUrl);
  const bulkCount = bulkUrls.split("\n").filter((u) => u.trim()).length;

  let targetNote: string | null = null;
  if (probeOnly) {
    targetNote =
      "IPv4 target. DNS and the service probes you pick will run, web checks need a hostname.";
  } else if (isHttpScheme) {
    targetNote =
      "Plain HTTP target. Certificate and TLS checks are skipped for this run.";
  } else if (trimmedUrl && looksLikeDomain(trimmedUrl)) {
    targetNote = `${effectiveFamilies} of ${totalFamilies} check families will run${
      probes.length > 0
        ? `, plus ${probes.length} service ${probes.length === 1 ? "probe" : "probes"}.`
        : "."
    }`;
  }

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {/* Mode strip */}
        <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5">
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
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                  isScanning && "cursor-not-allowed opacity-50",
                  FOCUS_RING,
                )}
              >
                <Icon aria-hidden className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
          <span className="ml-auto hidden pr-1 text-[11px] text-muted-foreground sm:block">
            {mode === "quick" && "One page, every enabled family"}
            {mode === "deep" && "Crawl first, then pick the pages to scan"}
            {mode === "bulk" && `Up to ${BULK_URL_LIMIT} URLs, one per line`}
          </span>
        </div>

        {/* Privacy toggle -- applies to whichever mode is active (quick,
            deep, or bulk), so it lives outside the two mode-specific forms
            below rather than being duplicated in each. Seeded from the
            account's "scans are private by default" setting (Profile ->
            Privacy) via the defaultPrivate prop. */}
        <div className="flex items-center gap-2.5 border-b border-border bg-muted/10 px-3 py-2">
          <Lock
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
          <label
            htmlFor="scan-keep-private"
            className="text-xs font-medium text-foreground"
          >
            Keep this scan private
          </label>
          <span className="hidden text-[11px] text-muted-foreground sm:block">
            {keepPrivate
              ? "Skips the public host page."
              : "Findings go to the public host page when this finishes."}
          </span>
          <Switch
            id="scan-keep-private"
            checked={keepPrivate}
            onCheckedChange={(checked) => {
              userTouchedPrivacyRef.current = true;
              setKeepPrivate(checked);
            }}
            disabled={isScanning || isBulkScanning}
            aria-label="Keep this scan private"
            className="ml-auto"
          />
        </div>

        {/* Single-target form */}
        <form
          onSubmit={handleSubmit}
          className={cn("flex flex-col", mode === "bulk" && "hidden")}
        >
          <label htmlFor="scan-url-input" className="sr-only">
            Domain, URL, or IPv4 address
          </label>
          <div className="flex flex-col gap-2 p-2 sm:flex-row sm:p-2.5">
            <div className="relative flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
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
                className={cn(
                  "h-11 border-border bg-background pl-9 font-mono text-base sm:text-sm",
                  FOCUS_RING,
                )}
                aria-label="Domain, URL, or IPv4 address"
                aria-invalid={!!error}
                aria-describedby={error ? "url-error" : undefined}
              />
            </div>

            <div className="flex items-center gap-2">
              <Popover open={scannersOpen} onOpenChange={setScannersOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isScanning}
                    className={cn(
                      "h-11 shrink-0 gap-1.5 bg-transparent px-3 text-sm",
                      !allFamiliesSelected && "border-primary/40 text-primary",
                      FOCUS_RING,
                    )}
                    aria-label={`Check families, ${effectiveFamilies} of ${totalFamilies} enabled`}
                  >
                    <ListFilter aria-hidden className="h-4 w-4" />
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
                  className="w-72 overflow-hidden p-0"
                >
                  <div className="border-b border-border bg-muted/30 px-3 pb-2 pt-3">
                    <div className="mb-0.5 flex items-center justify-between gap-2">
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
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10",
                          FOCUS_RING,
                        )}
                      >
                        {effectiveFamilies === 0 ? "Enable all" : "Disable all"}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {effectiveFamilies}/{totalFamilies} enabled
                      {probeOnly && ". Web checks are off for a raw IP"}
                    </p>
                  </div>
                  <div className="max-h-72 space-y-0.5 overflow-y-auto p-1">
                    {CHECK_FAMILIES.map(
                      ({ id, label, shortLabel, group, requiresTls }, i) => {
                        const autoOff = requiresTls && autoDisabled.has(id);
                        const active = !autoOff && enabledFamilies.has(id);
                        const newGroup =
                          i === 0 || CHECK_FAMILIES[i - 1].group !== group;
                        return (
                          <Fragment key={id}>
                            {newGroup && (
                              <p
                                className={cn(
                                  "px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60",
                                  i > 0 && "pt-2",
                                )}
                              >
                                {group}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleFamily(id)}
                              disabled={isScanning || autoOff}
                              aria-pressed={active}
                              className={cn(
                                "group relative flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                                active && "bg-primary/5 hover:bg-primary/10",
                                !active && !autoOff && "hover:bg-muted/60",
                                autoOff && "cursor-not-allowed opacity-40",
                                isScanning && "cursor-not-allowed opacity-50",
                                FOCUS_RING,
                              )}
                            >
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
                                <span className="ml-1 hidden font-normal text-muted-foreground/70 sm:inline">
                                  {label.replace(shortLabel, "").trim()}
                                </span>
                              </span>
                              <span
                                aria-hidden
                                className={cn(
                                  "ml-auto flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                                  active
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-transparent group-hover:border-muted-foreground/50",
                                  autoOff && "opacity-30",
                                )}
                              >
                                {active && (
                                  <Check
                                    className="h-2.5 w-2.5"
                                    strokeWidth={3}
                                  />
                                )}
                              </span>
                            </button>
                          </Fragment>
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
                    disabled={isScanning}
                    className={cn(
                      "h-11 shrink-0 gap-1.5 bg-transparent px-3 text-sm",
                      probes.length > 0 && "border-primary/40 text-primary",
                      FOCUS_RING,
                    )}
                    aria-label={`Service probes, ${probes.length} of ${SERVICE_PROBES.length} selected`}
                  >
                    <Plug aria-hidden className="h-4 w-4" />
                    <span className="font-mono tabular-nums">
                      {probes.length}/{SERVICE_PROBES.length}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  sideOffset={6}
                  className="w-72 overflow-hidden p-0"
                >
                  <div className="border-b border-border bg-muted/30 px-3 pb-2 pt-3">
                    <div className="mb-0.5 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-foreground">
                        Service probes
                      </h3>
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {probes.length}/{SERVICE_PROBES.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Opens a TCP socket per service and reads the greeting.
                    </p>
                  </div>
                  <div className="max-h-72 space-y-0.5 overflow-y-auto p-1">
                    {SERVICE_PROBES.map(
                      ({ id, label, defaultPort, altPorts }) => {
                        const probe = probes.find((p) => p.id === id);
                        const active = !!probe;
                        return (
                          <div
                            key={id}
                            className={cn(
                              "rounded transition-colors",
                              active && "border border-primary/30 bg-primary/5",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => toggleProbe(id)}
                              disabled={isScanning}
                              aria-pressed={active}
                              className={cn(
                                "group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                                active
                                  ? "hover:bg-primary/10"
                                  : "hover:bg-muted/60",
                                FOCUS_RING,
                              )}
                            >
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
                              <span className="ml-auto mr-1 font-mono text-[11px] text-muted-foreground/70">
                                :{defaultPort}
                              </span>
                              <span
                                aria-hidden
                                className={cn(
                                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                                  active
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-transparent group-hover:border-muted-foreground/50",
                                )}
                              >
                                {active && (
                                  <Check
                                    className="h-2.5 w-2.5"
                                    strokeWidth={3}
                                  />
                                )}
                              </span>
                            </button>
                            {active && probe && (
                              <div className="mt-0.5 flex items-center gap-1.5 border-t border-primary/20 px-2 pb-1.5 pt-1">
                                <label
                                  htmlFor={`probe-port-${id}`}
                                  className="shrink-0 font-mono text-[11px] text-muted-foreground"
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
                                    setProbePort(
                                      id,
                                      parseInt(e.target.value, 10),
                                    )
                                  }
                                  disabled={isScanning}
                                  className={cn(
                                    "h-7 w-20 bg-background px-1.5 font-mono text-base sm:text-[11px] tabular-nums",
                                    FOCUS_RING,
                                  )}
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
                                        aria-pressed={probe.port === alt}
                                        className={cn(
                                          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors",
                                          probe.port === alt
                                            ? "bg-primary/20 text-primary"
                                            : "bg-muted text-muted-foreground hover:text-foreground",
                                          FOCUS_RING,
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

              <Button
                type="submit"
                size="lg"
                disabled={isScanning}
                className={cn(
                  "h-11 flex-1 gap-2 px-6 sm:flex-none",
                  FOCUS_RING,
                )}
              >
                {isScanning ? (
                  <>
                    <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                    Scanning
                  </>
                ) : (
                  <>
                    Scan
                    <ArrowRight aria-hidden className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>

          <InlineAuthForm
            ref={authFormRef}
            disabled={isScanning}
            onChange={setAuthValue}
          />

          {(error || targetNote) && (
            <div className="border-t border-border px-3 py-2">
              {error ? (
                <p
                  id="url-error"
                  role="alert"
                  className="flex items-center gap-1.5 text-xs text-destructive"
                >
                  <X aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              ) : (
                <p className="text-xs leading-snug text-muted-foreground">
                  {targetNote}
                </p>
              )}
            </div>
          )}
        </form>

        {/* Bulk form */}
        <form
          onSubmit={handleBulkSubmit}
          className={cn("flex flex-col", mode !== "bulk" && "hidden")}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <label
              htmlFor="bulk-urls-input"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <ListChecks aria-hidden className="h-3.5 w-3.5" />
              One full URL per line
            </label>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-mono text-xs tabular-nums",
                  bulkCount > BULK_URL_LIMIT
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {bulkCount}/{BULK_URL_LIMIT}
              </span>
              {bulkUrls && (
                <button
                  type="button"
                  onClick={() => setBulkUrls("")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    FOCUS_RING,
                  )}
                >
                  <X aria-hidden className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          </div>
          <textarea
            id="bulk-urls-input"
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
            className={cn(
              "w-full resize-y bg-transparent px-3 py-2.5 font-mono text-base sm:text-xs text-foreground placeholder:text-muted-foreground/60 disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
            aria-label="URLs to bulk scan, one per line"
            aria-invalid={!!bulkError}
            aria-describedby={bulkError ? "bulk-error" : undefined}
          />

          {isBulkScanning && bulkProgress && (
            <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground">
                  Scanning URL {bulkProgress.current} of {bulkProgress.total}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {Math.round(
                    (bulkProgress.current / bulkProgress.total) * 100,
                  )}
                  %
                </span>
              </div>
              <div
                className="h-1 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={bulkProgress.total}
                aria-valuenow={bulkProgress.current}
                aria-label="Bulk scan progress"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{
                    width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {bulkError && (
            <p
              id="bulk-error"
              role="alert"
              className="flex items-start gap-1.5 border-t border-border px-3 py-2 text-xs text-destructive"
            >
              <X aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {bulkError}
            </p>
          )}

          <div className="flex justify-end border-t border-border p-2 sm:p-2.5">
            <Button
              type="submit"
              size="lg"
              disabled={isBulkScanning || !bulkUrls.trim()}
              className={cn("h-11 gap-2 px-6", FOCUS_RING)}
            >
              {isBulkScanning ? (
                <>
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  Scanning{" "}
                  {bulkProgress
                    ? `${bulkProgress.current}/${bulkProgress.total}`
                    : ""}
                </>
              ) : (
                <>
                  <ListChecks aria-hidden className="h-4 w-4" />
                  Start bulk scan
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { SERVICE_PROBES, parseProbesFromQuery, serializeProbesToQuery };
