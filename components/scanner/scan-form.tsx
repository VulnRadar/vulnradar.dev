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
  ListFilter,
  Crosshair,
  Lock,
  Camera,
  Network,
  AlertTriangle,
  FileJson,
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
import { toggles } from "@/lib/ui/animations";
import type { Category, ScanStatus } from "@/lib/scanner/types";
import { CATEGORY_META } from "@/lib/scanner/category-meta";
import {
  ACTIVE_PROBE_OPTIONS,
  ACTIVE_PROBE_IDS,
  activeProbeScanner,
  parseActiveProbeIds,
  serializeActiveProbeIds,
  type ActiveProbeId,
} from "@/lib/scanner/active-probe-catalog";
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
import { API, BULK_SCAN_CLIENT_URL_LIMIT } from "@/lib/config/client-constants";
import { classifyScanTarget } from "@/lib/scanner/scan-target-classify";
import { useAuth } from "@/components/providers/auth-provider";
export type ScanMode = "quick" | "deep" | "bulk";
export type { InlineAuthValue };

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
];

/** Copy shown above the nine active-probe toggles. These submit real
 *  requests to the target rather than only reading its responses, so they are
 *  their own opt-in group (never in CHECK_FAMILIES, never on by default) and
 *  the API holds every one of them to the verified-domain-ownership gate. */
const ACTIVE_PROBE_GROUP = "Active probing (writes to target)";

export interface ScanFormPayload {
  url: string;
  mode: ScanMode;
  /** Selected check-family category ids plus any `active-probes:<id>` probe
   *  selectors (see lib/scanner/active-probe-catalog.ts). String-typed rather
   *  than `Category[]` because the probe selectors are not categories. */
  scanners?: string[];
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
  /** From the "Capture page screenshot" toggle. Opt-in and off by default:
   *  a screenshot spins up a real, metered BrowserBase session, so it is
   *  only ever sent when the user turned it on. Single-target scans only
   *  (quick/deep) -- bulk runs never request one. */
  captureScreenshot?: boolean;
  /** From the "Scan common ports" toggle. Opt-in and off by default: a port
   *  sweep turns the server into a scan source, so the API holds it to the
   *  same verified-domain-ownership gate as active probing. Single-target
   *  scans only (quick/deep). */
  portScan?: boolean;
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
 * Absolute fallback cap on a bulk run, used only until the caller's real
 * plan limit (me.bulkScanUrls) has loaded, or for a plan with no cap at
 * all (billing disabled). Deliberately independent of the server-enforced
 * MAX_URLS_BULK setting because this form fans out one request per URL
 * instead of hitting the batch endpoint.
 */
const BULK_URL_FALLBACK_LIMIT = BULK_SCAN_CLIENT_URL_LIMIT;
/** Sane ceiling for an "unlimited" (-1) plan -- this form still fans out
 *  one sequential request per URL, so an actually-unbounded paste would
 *  let a single submission run for a very long time and hang the tab. */
const BULK_URL_UNLIMITED_CEILING = 500;

const FOCUS_RING =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** Ceiling on a spec file the bulk tab will parse in the browser. An OpenAPI
 *  or Postman document is text and lands far under this; anything bigger is
 *  not a spec, and JSON.parse on it would lock the tab up. */
const SPEC_MAX_BYTES = 5 * 1024 * 1024;

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
 *   raw IPv4                -> no HTTP checks (DNS/email only)
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

export function ScanForm({
  onScan,
  onBulkScan,
  bulkStatus = "idle",
  bulkProgress,
  status,
  defaultPrivate,
}: ScanFormProps) {
  const { me } = useAuth();
  // The caller's real, admin-configurable bulk-scan cap (see
  // app/api/v3/auth/me/route.ts), not a flat constant -- this is exactly
  // the number the pricing page advertises per plan (5/10/25/100), so it
  // must be the one the UI actually enforces.
  const bulkUrlLimit =
    me?.bulkScanUrls === undefined
      ? BULK_URL_FALLBACK_LIMIT
      : me.bulkScanUrls === -1
        ? BULK_URL_UNLIMITED_CEILING
        : me.bulkScanUrls;
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  // Set when the entered URL isn't a useful target (a search engine / results
  // page). We don't block -- the user can scan anyway -- we just warn first.
  const [targetWarning, setTargetWarning] = useState<string | null>(null);
  const [mode, setMode] = useState<ScanMode>(() =>
    parseModeFromQuery(getQueryParam("mode")),
  );
  const [enabledFamilies, setEnabledFamilies] = useState<Set<Category>>(
    () =>
      new Set(
        CHECK_FAMILIES.map((f) => f.id).filter(
          (id) => getQueryParam(`family_${id}`) !== "0",
        ),
      ),
  );
  // Which of the nine active probes are selected. Opt-in and off by default,
  // so the seed is empty unless the URL names some.
  const [selectedActiveProbes, setSelectedActiveProbes] = useState<
    Set<ActiveProbeId>
  >(() => new Set(parseActiveProbeIds(getQueryParam("active_probes"))));
  const [scannersOpen, setScannersOpen] = useState(false);
  const [activeProbesOpen, setActiveProbesOpen] = useState(false);

  // Close-on-page-scroll (the iOS momentum-scroll hitch fix these two panels
  // originally needed) now lives in the shared Popover wrapper
  // (components/ui/popover.tsx via lib/ui/use-close-on-scroll.ts), so every
  // popover in the app behaves this way and this no longer needs a bespoke
  // effect here.
  const [bulkUrls, setBulkUrls] = useState("");
  const [bulkError, setBulkError] = useState("");
  // POST /api/v3/scan/import-spec turns an OpenAPI 3, Swagger 2, or Postman
  // document into a list of scan targets. It shipped with no caller at all, so
  // the only way to reach it was curl (AUDIT-011#drift-21). The bulk tab is
  // where its output belongs: it produces exactly the one-URL-per-line list
  // this textarea takes.
  const [specImporting, setSpecImporting] = useState(false);
  const [specNote, setSpecNote] = useState("");
  const specInputRef = useRef<HTMLInputElement>(null);
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

  // "Capture page screenshot" -- opt-in, off by default. A screenshot spins
  // up a real, metered live-browser session, so it is never on unless the
  // user turns it on. Seeded from the URL so a shared ?screenshot=1 link
  // pre-selects it.
  const [captureScreenshot, setCaptureScreenshot] = useState(
    () => getQueryParam("screenshot") === "1",
  );

  // "Scan common ports" -- opt-in, off by default. A port sweep makes the
  // server a scan source against the target, so the API requires a verified
  // domain (the same gate active probing uses). Seeded from the URL so a
  // shared ?port_scan=1 link pre-selects it.
  const [portScan, setPortScan] = useState(
    () => getQueryParam("port_scan") === "1",
  );

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
  const activeProbeCount = selectedActiveProbes.size;
  const totalActiveProbes = ACTIVE_PROBE_OPTIONS.length;

  useEffect(() => {
    // scanner: always set ?mode=... so the URL reflects the current
    // scan mode. Previously we omitted the param when mode === "quick"
    // (the default), but the user wants the URL to be self-describing:
    // even the default state should be explicit in the URL.
    //
    // replace, not push: this is an effect mirroring form state into the
    // URL, so every toggle of a check family, the screenshot switch or the
    // port-scan switch used to add its own history entry. Configuring a
    // deep scan could leave a dozen entries behind, and the back button then
    // walked back through them one checkbox at a time instead of leaving the
    // page. Toggling a setting is not a navigation.
    setQueryParams(
      {
        mode,
        active_probes: serializeActiveProbeIds(selectedActiveProbes),
        screenshot: captureScreenshot ? "1" : null,
        port_scan: portScan ? "1" : null,
      },
      { replace: true },
    );
    for (const family of CHECK_FAMILIES) {
      setQueryParam(
        `family_${family.id}`,
        enabledFamilies.has(family.id) ? null : "0",
        { replace: true },
      );
    }
  }, [
    mode,
    enabledFamilies,
    selectedActiveProbes,
    captureScreenshot,
    portScan,
  ]);

  function toggleFamily(id: Category) {
    setEnabledFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleActiveProbe(id: ActiveProbeId) {
    setSelectedActiveProbes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    // Warn (but don't block) before scanning a non-target like a search engine
    // results page. "Scan anyway" in the warning banner calls dispatchScan()
    // directly, so reaching here with a warning already showing still proceeds.
    const classification = classifyScanTarget(url);
    if (!classification.scannable && targetWarning === null) {
      setTargetWarning(
        classification.reason ?? "This may not be a useful scan target.",
      );
      return;
    }
    dispatchScan();
  }

  function dispatchScan() {
    setTargetWarning(null);
    const familyList = CHECK_FAMILIES.map((f) => f.id).filter(
      (id) => enabledFamilies.has(id) && !autoDisabled.has(id),
    );
    // Each selected active probe rides in `scanners` as its own
    // `active-probes:<id>` selector, so the engine runs exactly the probes
    // picked (see lib/scanner/active-probe-catalog.ts). These are opt-in and
    // never implied by an omitted filter.
    const activeProbeSelectors = ACTIVE_PROBE_IDS.filter((id) =>
      selectedActiveProbes.has(id),
    ).map(activeProbeScanner);
    // Omitting `scanners` means "run every default category" server-side (see
    // async-checks.ts's buildBranches), which never includes any active
    // probe. So the filter can only be omitted when every family is enabled
    // AND no active probe is selected -- any active-probe pick needs an
    // explicit list to tell the server to run it.
    const scanners: string[] | undefined =
      activeProbeSelectors.length === 0 &&
      familyList.length === CHECK_FAMILIES.length
        ? undefined
        : [...familyList, ...activeProbeSelectors];
    onScan({
      url: normalizeInput(url),
      mode,
      scanners,
      auth: authValue ?? undefined,
      isPublic: !keepPrivate,
      captureScreenshot,
      portScan,
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
    if (lines.length > bulkUrlLimit) {
      setBulkError(
        `${lines.length} URLs entered. A bulk run takes at most ${bulkUrlLimit}.`,
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

  /**
   * Read a spec file the user picked, hand the parsed document to
   * /api/v3/scan/import-spec, and merge the URLs it finds into the bulk list.
   *
   * The document is parsed here and POSTed as JSON rather than sending a URL
   * for the server to fetch: that is the route's own reason for taking the
   * document directly, and it keeps spec import off the SSRF surface.
   */
  async function handleSpecFile(file: File) {
    setBulkError("");
    setSpecNote("");
    // A spec is a text document; anything this size is not one, and parsing it
    // would just freeze the tab.
    if (file.size > SPEC_MAX_BYTES) {
      setBulkError("That file is too large to be an API spec (over 5 MB).");
      return;
    }
    setSpecImporting(true);
    try {
      let spec: unknown;
      try {
        spec = JSON.parse(await file.text());
      } catch {
        setBulkError(
          "That file is not valid JSON. Export the spec as JSON (a YAML spec has to be converted first).",
        );
        return;
      }
      const res = await fetch(API.SCAN_IMPORT_SPEC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBulkError(data?.error || "Could not read that spec.");
        return;
      }
      const targets: string[] = Array.isArray(data.targets) ? data.targets : [];
      if (targets.length === 0) {
        setBulkError("That spec declared no scannable URLs.");
        return;
      }
      // Merged, not replaced: someone importing a second spec, or adding one
      // to URLs they already typed, should not silently lose the first set.
      const existing = bulkUrls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...existing, ...targets]));
      setBulkUrls(merged.join("\n"));
      const added = merged.length - existing.length;
      setSpecNote(
        added === 0
          ? `${data.format} spec read: every URL in it was already listed.`
          : `Added ${added} URL${added === 1 ? "" : "s"} from a ${data.format} spec.`,
      );
      if (merged.length > bulkUrlLimit) {
        setBulkError(
          `That is ${merged.length} URLs. A bulk run takes at most ${bulkUrlLimit}, so trim the list before scanning.`,
        );
      }
    } catch {
      setBulkError("Could not reach the server to read that spec.");
    } finally {
      setSpecImporting(false);
      // Clear the input so picking the SAME file again still fires a change.
      if (specInputRef.current) specInputRef.current.value = "";
    }
  }

  const allFamiliesSelected = effectiveFamilies === totalFamilies;
  const trimmedUrl = url.trim();
  const isHttpScheme = /^http:\/\//i.test(trimmedUrl);
  const bulkCount = bulkUrls.split("\n").filter((u) => u.trim()).length;

  let targetNote: string | null = null;
  if (probeOnly) {
    targetNote = "IPv4 target. DNS runs, web checks need a hostname.";
  } else if (isHttpScheme) {
    targetNote =
      "Plain HTTP target. Certificate and TLS checks are skipped for this run.";
  } else if (trimmedUrl && looksLikeDomain(trimmedUrl)) {
    const extras: string[] = [];
    if (activeProbeCount > 0) {
      extras.push(
        `${activeProbeCount} active ${activeProbeCount === 1 ? "probe" : "probes"}`,
      );
    }
    targetNote = `${effectiveFamilies} of ${totalFamilies} check families will run${
      extras.length > 0 ? `, plus ${extras.join(" and ")}.` : "."
    }`;
  }

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
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
                  `inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium ${toggles.control}`,
                  active
                    ? "bg-card text-foreground shadow-xs"
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
            {mode === "bulk" && `Up to ${bulkUrlLimit} URLs, one per line`}
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
                  if (targetWarning) setTargetWarning(null);
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
                      {effectiveFamilies}/{totalFamilies}
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
                      ({ id, shortLabel, group, requiresTls }, i) => {
                        const autoOff = requiresTls && autoDisabled.has(id);
                        const active = !autoOff && enabledFamilies.has(id);
                        const blurb = CATEGORY_META[id]?.blurb ?? "";
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
                                `group relative flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${toggles.control}`,
                                active && "bg-primary/5 hover:bg-primary/10",
                                !active && !autoOff && "hover:bg-muted/60",
                                autoOff && "cursor-not-allowed opacity-40",
                                isScanning && "cursor-not-allowed opacity-50",
                                FOCUS_RING,
                              )}
                            >
                              <span className="flex min-w-0 flex-col gap-0.5">
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
                                </span>
                                {blurb && (
                                  <span className="text-[11px] font-normal leading-snug text-muted-foreground/70">
                                    {blurb}
                                  </span>
                                )}
                              </span>
                              <span
                                aria-hidden
                                className={cn(
                                  `ml-auto flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${toggles.control}`,
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

              <Popover
                open={activeProbesOpen}
                onOpenChange={setActiveProbesOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isScanning}
                    className={cn(
                      "h-11 shrink-0 gap-1.5 bg-transparent px-3 text-sm",
                      activeProbeCount > 0 && "border-primary/40 text-primary",
                      FOCUS_RING,
                    )}
                    aria-label={`Active probing, ${activeProbeCount} of ${totalActiveProbes} enabled`}
                  >
                    <Crosshair aria-hidden className="h-4 w-4" />
                    <span className="font-mono tabular-nums">
                      {activeProbeCount}/{totalActiveProbes}
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
                        {ACTIVE_PROBE_GROUP}
                      </h3>
                      <span className="font-mono text-[11px] tabular-nums text-primary/70">
                        {activeProbeCount}/{totalActiveProbes}
                      </span>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Each sends real payloads to the target and needs a
                      verified domain. Off by default.
                    </p>
                  </div>
                  <div className="max-h-72 space-y-0.5 overflow-y-auto p-1">
                    {ACTIVE_PROBE_OPTIONS.map(({ id, label, description }) => {
                      const active = selectedActiveProbes.has(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleActiveProbe(id)}
                          disabled={isScanning}
                          aria-pressed={active}
                          className={cn(
                            `group relative flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${toggles.control}`,
                            active && "bg-primary/5 hover:bg-primary/10",
                            !active && "hover:bg-muted/60",
                            isScanning && "cursor-not-allowed opacity-50",
                            FOCUS_RING,
                          )}
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
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
                            <span className="text-[11px] font-normal leading-snug text-muted-foreground/70">
                              {description}
                            </span>
                          </span>
                          <span
                            aria-hidden
                            className={cn(
                              "ml-auto flex h-3.5 w-3.5 shrink-0 items-center justify-center self-start rounded border",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-transparent group-hover:border-muted-foreground/50",
                            )}
                          >
                            {active && (
                              <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            )}
                          </span>
                        </button>
                      );
                    })}
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

          {/* Opt-in page screenshot. Its own row (not in either popover)
              because it's a single boolean, not a set of families/probes.
              Off by default: a capture opens a real, metered live-browser
              session, so the helper text says so plainly. */}
          <div className="flex items-center gap-2.5 border-t border-border px-3 py-2">
            <Camera
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
            <label
              htmlFor="scan-capture-screenshot"
              className="text-xs font-medium text-foreground"
            >
              Capture page screenshot
            </label>
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              Opens a real browser once. Uses your live-browser minutes.
            </span>
            <Switch
              id="scan-capture-screenshot"
              checked={captureScreenshot}
              onCheckedChange={setCaptureScreenshot}
              disabled={isScanning}
              aria-label="Capture page screenshot"
              className="ml-auto"
            />
          </div>

          {/* Opt-in port sweep. Its own row like the screenshot toggle. A port
              sweep makes the server a scan source, so it needs a verified
              domain -- the helper text says so and the API enforces it. Off by
              default. */}
          <div className="flex items-center gap-2.5 border-t border-border px-3 py-2">
            <Network
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
            <label
              htmlFor="scan-port-scan"
              className="text-xs font-medium text-foreground"
            >
              Scan common ports
            </label>
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              Sweeps ~130 well-known ports. Needs a verified domain.
            </span>
            <Switch
              id="scan-port-scan"
              checked={portScan}
              onCheckedChange={setPortScan}
              disabled={isScanning}
              aria-label="Scan common ports"
              className="ml-auto"
            />
          </div>

          {targetWarning && (
            <div className="border-t border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]"
                />
                <div className="flex-1 space-y-2">
                  <p className="text-xs leading-snug text-foreground">
                    {targetWarning}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={dispatchScan}
                    >
                      Scan anyway
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setTargetWarning(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

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
                  bulkCount > bulkUrlLimit
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {bulkCount}/{bulkUrlLimit}
              </span>
              <input
                ref={specInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleSpecFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => specInputRef.current?.click()}
                disabled={isBulkScanning || specImporting}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                  FOCUS_RING,
                )}
              >
                <FileJson aria-hidden className="h-3 w-3" />
                {specImporting ? "Reading..." : "Import spec"}
              </button>
              {bulkUrls && (
                <button
                  type="button"
                  onClick={() => {
                    setBulkUrls("");
                    setSpecNote("");
                  }}
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
              if (specNote) setSpecNote("");
            }}
            rows={6}
            disabled={isBulkScanning}
            className={cn(
              "w-full resize-y bg-transparent px-3 py-2.5 font-mono text-base sm:text-xs text-foreground placeholder:text-muted-foreground/60 disabled:opacity-50",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
            aria-label="URLs to bulk scan, one per line"
            aria-invalid={!!bulkError}
            aria-describedby={bulkError ? "bulk-error" : undefined}
          />

          {specNote && !bulkError && (
            <p
              role="status"
              className="border-t border-border px-3 py-2 text-xs text-muted-foreground"
            >
              {specNote}
            </p>
          )}

          {isBulkScanning && bulkProgress && (
            <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground">
                  Queuing scan {bulkProgress.current} of {bulkProgress.total}
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
                aria-label="Bulk scan queueing progress"
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
                  Queuing{" "}
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
