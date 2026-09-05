"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn, safeHref } from "@/lib/ui/utils";
import {
  BotMessageSquare,
  Check,
  CircleDot,
  GitCompareArrows,
  Eye,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  Globe,
  Loader2,
  Lock,
  RefreshCw,
  ScrollText,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PageActionsMenu,
  type PageActionEntry,
  type PageActionItem,
} from "@/components/shared";
import { useToast } from "@/components/ui/use-toast";
import { downloadBlob } from "@/lib/ui/download";
import { ShareModal } from "./share-modal";
import { AiVerifyResultModal } from "./ai-verify-result-modal";
import { AiSummaryModal } from "./ai-summary-modal";
import { generatePdfReport } from "@/lib/reports/pdf-report";
import { generateSarifReport } from "@/lib/reports/sarif-report";
import { generateMarkdownReport } from "@/lib/reports/markdown-report";
import { generateCsvReport } from "@/lib/reports/csv-report";
import { generateComplianceReport } from "@/lib/reports/compliance-report";
import {
  API,
  APP_NAME,
  APP_SLUG,
  APP_VERSION,
  ROUTES,
  hasTeamPermission,
} from "@/lib/config/client-constants";
import { apiDelete, apiPost, ApiError } from "@/lib/api/client";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import { canOfferAiReview } from "./ai-review-gate";
import { useAuth } from "@/components/providers/auth-provider";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

interface ScanActionsMenuProps {
  result: ScanResult;
  /** Undefined for a scan that has not been saved to history yet: hides Share
   *  and AI review. The opaque public_id (History detail) or a numeric id (the
   *  dashboard's just-completed result); the history/scan routes resolve both. */
  scanId?: string | number | null;
  /** Only meaningful together with onDeleted: hides Delete when either is missing. */
  isOwner?: boolean;
  onDeleted?: () => void;
  /** Called with the updated findings once an on-demand AI review finishes. */
  onVerified?: (findings: Vulnerability[]) => void;
  /** Called with the generated text once an on-demand AI summary finishes. */
  onSummaryGenerated?: (summary: string) => void;
  /**
   * Whether this scan's host_reputation entry (and public /host/[hostname]
   * page) may reflect it. Undefined is treated as true -- scan_history.is_public
   * defaults to true, so a caller that hasn't loaded it yet shows "Make
   * private" rather than guessing wrong.
   */
  isPublic?: boolean;
  /** Called with the new value once the privacy toggle PATCH succeeds. */
  onPrivacyChanged?: (isPublic: boolean) => void;
}

/**
 * Leading byte-order mark for CSV exports. Excel on Windows ignores the
 * charset in a blob's MIME type and falls back to the system ANSI code page
 * when a CSV has no BOM, which turned every non-ASCII character in a finding
 * into mojibake. Every other CSV reader skips it silently.
 */
const UTF8_BOM = "\uFEFF";

function isMobileBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )
  );
}

/** Hostname for the Compare deep link, or null when the URL is unparseable. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** A team this scan can be handed to, plus the two facts that make the choice
 *  meaningful: how many people would gain access, and what the caller's own
 *  role on that team is. */
interface AssignableTeam {
  id: number;
  name: string;
  role: string;
  memberCount: number;
}

/** Secondary line under a team's name in the picker, e.g. "4 members, you are
 *  an admin". Team roles are free-form enough (owner, admin, member, viewer)
 *  that the article is chosen from the word rather than hardcoded. */
function teamPickerMeta(team: AssignableTeam): string {
  const members = `${team.memberCount} member${team.memberCount === 1 ? "" : "s"}`;
  const article = /^[aeiou]/i.test(team.role) ? "an" : "a";
  return `${members}, you are ${article} ${team.role}`;
}

/**
 * One row of the team picker, shared by the "Just me" row and the team rows so
 * the two cannot drift apart.
 *
 * The team rows used to be a radiogroup, because a scan could only ever belong
 * to one team: picking a second silently un-shared the first. A scan now
 * carries a SET of teams (scan_history_teams), so they are checkboxes and
 * `toggle` says which shape a row is. The "Just me" row is not one of the
 * checkboxes: it is the clear-all action, checked only as a readout of "no
 * teams", which is why it stays a plain button.
 *
 * Selection is carried by aria-checked for assistive tech; the mark on the
 * right is decorative and mirrors it for everyone else -- square for a
 * checkbox, round for the "Just me" state.
 */
function TeamPickerRow({
  icon: Icon,
  label,
  meta,
  selected,
  pending,
  disabled,
  toggle,
  onSelect,
}: {
  icon: typeof Users;
  label: string;
  meta: string;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  toggle: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      {...(toggle ? { role: "checkbox", "aria-checked": selected } : {})}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        // items-start, because the meta line below wraps now.
        "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-primary bg-primary/10"
          : "border-input hover:border-primary/40 hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
          selected
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {label}
        </span>
        {/* `meta` is a whole sentence we wrote ("Shared already. Your role
            there can no longer manage scans, so you cannot remove it."), so
            one clipped line left only the first few words. It wraps; `label`
            above keeps truncating because that one is a team name. */}
        <span className="block text-xs leading-snug text-muted-foreground">
          {meta}
        </span>
      </span>
      {pending ? (
        <Loader2
          aria-hidden
          className="h-5 w-5 shrink-0 animate-spin text-primary"
        />
      ) : selected ? (
        <span
          aria-hidden
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center bg-primary text-primary-foreground",
            toggle ? "rounded-md" : "rounded-full",
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <span
          aria-hidden
          className={cn(
            "h-5 w-5 shrink-0 border border-input",
            toggle ? "rounded-md" : "rounded-full",
          )}
        />
      )}
    </button>
  );
}

/**
 * Kebab-menu replacement for the row of individual Export/Share/View/Delete
 * buttons a scan detail header used to show. Used on every scan detail view
 * (dashboard, history, shared) so the same actions are available everywhere
 * a ScanResult renders, gated per-page by isOwner/scanId.
 */
export function ScanActionsMenu({
  result,
  scanId,
  isOwner,
  onDeleted,
  onVerified,
  onSummaryGenerated,
  isPublic,
  onPrivacyChanged,
}: ScanActionsMenuProps) {
  const { me } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { featurePdfReports, featureTeams } = useClientConfig();
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharePubliclyListed, setSharePubliclyListed] = useState(true);
  const [togglingShareListing, setTogglingShareListing] = useState(false);
  // POST /api/v3/history/[id]/share has accepted expiresInDays (7, 30, 90 or
  // null for never) since the field was added, and returns the resolved
  // expiresAt, but nothing in the product ever sent it or showed it: every
  // share link was permanent with no way to see that or change it.
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [updatingShareExpiry, setUpdatingShareExpiry] = useState(false);

  const [togglingPrivacy, setTogglingPrivacy] = useState(false);
  const currentIsPublic = isPublic ?? true;

  // Team sharing. Only teams the caller can actually assign to are listed,
  // matching getAssignableTeamIds server-side, so the menu never offers an
  // action the API will reject.
  const [assignableTeams, setAssignableTeams] = useState<AssignableTeam[]>([]);
  /** Every team this scan is shared with. It was a single id until scans got
   *  a team SET: one scan can now sit in several teams at once, so picking a
   *  second team adds to the share instead of replacing it. */
  const [assignedTeamIds, setAssignedTeamIds] = useState<number[]>([]);
  const [assigningTeam, setAssigningTeam] = useState(false);
  /** Which picker row is mid-PATCH: a team id, `null` for the "Just me" row,
   *  or `undefined` when nothing is in flight. Kept apart from assigningTeam
   *  so the spinner lands on the row that was actually clicked instead of on
   *  every row at once. */
  const [pendingTeamId, setPendingTeamId] = useState<number | null | undefined>(
    undefined,
  );
  // One "Share with a team" row that opens a picker, rather than one menu row
  // per team. The per-team rows worked for two teams and fell apart for ten:
  // the whole kebab menu turned into a team list.
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  /** True once the scan's stored team assignment has been read back, so the
   *  picker fetches it at most once per mount. */
  const teamLoadedRef = useRef(false);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamLoadFailed, setTeamLoadFailed] = useState(false);
  /** Bumped by the picker's Try again button to re-run the load effect. */
  const [teamReloadKey, setTeamReloadKey] = useState(0);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewOpening, setViewOpening] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Which report format is currently being generated, or null. */
  const [exporting, setExporting] = useState<string | null>(null);

  // "File as GitHub issue" dialog (VulnRadar GitHub Scanner).
  // Gated on an actual GitHub connection, see the githubConnected effect below.
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubRepo, setGithubRepo] = useState("");
  const [githubFiling, setGithubFiling] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubResult, setGithubResult] = useState<{ url: string } | null>(
    null,
  );

  const [aiAvailable, setAiAvailable] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [verifiedFindings, setVerifiedFindings] = useState<
    Vulnerability[] | null
  >(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  // Lets closing the verify modal mid-request actually abort the /scan/verify
  // fetch instead of just hiding the UI while it keeps running in the background.
  const verifyAbortRef = useRef<AbortController | null>(null);

  const [summarizing, setSummarizing] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(
    result.aiSummary ?? null,
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // Same reasoning as verifyAbortRef above: lets closing the summary modal
  // mid-request actually abort the /history/[id]/summary fetch.
  const summaryAbortRef = useRef<AbortController | null>(null);

  // Only relevant once the scan is saved to history, since that's the
  // only state the verify endpoint can attach verdicts to.
  // Which teams this scan can be handed to. Owner-only, because the PATCH
  // route rejects a team change from anyone else.
  //
  // The "Share with a team" row already disappears when this comes back empty,
  // which is what FEATURE_TEAMS off produces (every /api/v3/teams route 403s),
  // so checking the flag here is about not issuing a request whose answer is
  // known rather than about the row.
  useEffect(() => {
    if (!scanId || !isOwner || !featureTeams) return;
    let cancelled = false;
    fetch(API.TEAMS)
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then(
        (d: {
          teams?: {
            id: number;
            name: string;
            role: string;
            member_count?: number | string;
          }[];
        }) => {
          if (cancelled) return;
          setAssignableTeams(
            (d.teams ?? [])
              .filter((t) => hasTeamPermission(t.role, "manage_scans"))
              .map((t) => ({
                id: t.id,
                name: t.name,
                role: t.role,
                // COUNT(*) comes back from pg as a string, so this has to be
                // coerced before it can be compared for pluralisation.
                memberCount: Number(t.member_count) || 0,
              })),
          );
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scanId, isOwner, featureTeams]);

  // The scan's current team, read once the picker is actually opened. It comes
  // from GET /api/v3/history/[id], whose response carries the whole findings
  // array, so this deliberately does NOT run on mount: nothing on the page
  // needs the assignment until the modal is on screen, and the menu label
  // falls back to "Share with a team" until then rather than paying for a
  // second copy of the scan on every result view.
  //
  // The picker distinguishes "not loaded yet" from "not shared": until this
  // resolves, assignedTeamIds is still its initial empty array, which the rows
  // would otherwise render as a confident "Just me". An owner opening the
  // picker on an already-shared scan would be told it is shared with nobody
  // and could reassign it without realising they were overwriting anything, so
  // the list stays behind a loading state (and a retry on failure) until the
  // answer is actually known.
  useEffect(() => {
    if (!teamModalOpen || !scanId || !isOwner) return;
    if (teamLoadedRef.current) return;
    let cancelled = false;
    setTeamLoading(true);
    setTeamLoadFailed(false);
    fetch(`${API.HISTORY}/${scanId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { teamId?: number | null; teamIds?: number[] } | null) => {
        if (cancelled) return;
        if (!d) {
          setTeamLoadFailed(true);
          setTeamLoading(false);
          return;
        }
        teamLoadedRef.current = true;
        // teamIds is the real set; teamId is the primary, still returned for
        // clients written against the single-team contract. Falling back to
        // it keeps this working against an older server.
        setAssignedTeamIds(
          d.teamIds ?? (typeof d.teamId === "number" ? [d.teamId] : []),
        );
        setTeamLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTeamLoadFailed(true);
        setTeamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamModalOpen, scanId, isOwner, teamReloadKey]);

  // "File as GitHub issue" needs a connected GitHub account with repo write
  // access: POST /api/v3/scan/github-issue reads the caller's stored token via
  // getDecryptedGithubToken and refuses without one. It was offered on every
  // saved scan regardless, so most users got a menu row that could only end in
  // an error dialog.
  //
  // Note for anyone revisiting this: the gate is the CONNECTION, not the scan's
  // origin. UI-BACKLOG item 15 suggested keying it on scan_history.source being
  // 'github', but that column is 'web' for repo scans too -- the literal
  // 'github' in app/api/v3/scan/github/route.ts is scan_type, one column
  // earlier. And repo scans never reach this menu at all: GET
  // /api/v3/history filters scan_type != 'github' and app/repos renders its own
  // GithubScanResultModal. Gating on repo-ness would have deleted the feature.
  // It is a URL-scan action by design (the issue body it files links to
  // /host/<hostname>); the repo is only where the issue gets filed.
  useEffect(() => {
    if (!scanId || !isOwner) return;
    let cancelled = false;
    fetch(API.ACCOUNT_GITHUB)
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((d: { connected?: boolean }) => {
        if (!cancelled) setGithubConnected(Boolean(d.connected));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scanId, isOwner]);

  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    fetch(API.AI_INFO)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAiAvailable(Boolean(d.configured) && !d.aiDisabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const hostname = (() => {
    try {
      return new URL(result.url).hostname.replace(/\./g, "-");
    } catch {
      return "scan";
    }
  })();
  const date = new Date().toISOString().split("T")[0];

  function exportJson() {
    const data = {
      meta: {
        tool: APP_NAME,
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
      },
      scan: {
        url: result.url,
        scannedAt: result.scannedAt,
        duration: result.duration,
        summary: result.summary,
      },
      findings: result.findings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
        description: f.description,
        evidence: f.evidence,
        riskImpact: f.riskImpact,
        explanation: f.explanation,
        fixSteps: f.fixSteps,
        codeExamples: f.codeExamples,
        ...(f.aiVerdict
          ? {
              aiVerdict: f.aiVerdict,
              aiConfidence: f.aiConfidence,
              aiReason: f.aiReason,
            }
          : {}),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const filename = `${APP_SLUG}-${hostname}-${date}.json`;
    downloadBlob(blob, filename);
    return filename;
  }

  function exportCsv() {
    const blob = new Blob([UTF8_BOM, generateCsvReport(result)], {
      type: "text/csv;charset=utf-8;",
    });
    const filename = `${APP_SLUG}-${hostname}-${date}.csv`;
    downloadBlob(blob, filename);
    return filename;
  }

  function exportPdf() {
    const pdfBytes = generatePdfReport(result);
    const blob = new Blob([new Uint8Array(pdfBytes)], {
      type: "application/pdf",
    });
    const filename = `${APP_SLUG}-${hostname}-${date}.pdf`;
    downloadBlob(blob, filename);
    return filename;
  }

  function exportSarif() {
    const sarif = generateSarifReport(result);
    const blob = new Blob([JSON.stringify(sarif, null, 2)], {
      type: "application/sarif+json",
    });
    const filename = `${APP_SLUG}-${hostname}-${date}.sarif`;
    downloadBlob(blob, filename);
    return filename;
  }

  function exportMarkdown() {
    const md = generateMarkdownReport(result);
    const blob = new Blob([md], { type: "text/markdown" });
    const filename = `${APP_SLUG}-${hostname}-${date}.md`;
    downloadBlob(blob, filename);
    return filename;
  }

  function exportCompliance() {
    const md = generateComplianceReport(result);
    const blob = new Blob([md], { type: "text/markdown" });
    const filename = `${APP_SLUG}-${hostname}-compliance-${date}.md`;
    downloadBlob(blob, filename);
    return filename;
  }

  /**
   * All six report generators are synchronous and walk every finding, every
   * fix step and every code example on the main thread: generatePdfReport is
   * a 500-line PDF writer. Wired straight to onSelect they closed the menu,
   * froze the tab for a beat and then said nothing at all, so a download that
   * landed in a folder the user does not watch was indistinguishable from a
   * no-op. Set a busy flag, yield one turn so the spinner actually paints
   * before the generator blocks, then name the file that was written.
   */
  async function runExport(key: string, generate: () => string) {
    if (exporting) return;
    setExporting(key);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const filename = generate();
      toast({ title: "Report downloaded", description: filename });
    } catch {
      toast({
        variant: "destructive",
        title: "Export failed",
        description:
          "The report could not be generated. Nothing was downloaded.",
      });
    } finally {
      setExporting(null);
    }
  }

  async function requestShare() {
    if (!scanId) return;
    if (shareUrl) {
      setShareModalOpen(true);
      return;
    }
    setShareLoading(true);
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}/share`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setShareUrl(`${window.location.origin}/shared/${data.token}`);
        // Defaults to true (matches the account-level default) if this
        // response shape predates publiclyListed -- never silently claims
        // "not listed" for a share that actually is.
        setSharePubliclyListed(data.publiclyListed ?? true);
        setShareExpiresAt(data.expiresAt ?? null);
        setShareModalOpen(true);
      } else {
        // The modal simply never opened before, so a failed share request
        // was identical to a menu item that did nothing.
        toast({
          variant: "destructive",
          title: "Couldn't create a share link",
          description: data.error || "The server refused the request.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't create a share link",
        description: "Couldn't reach the server. Check your connection.",
      });
    } finally {
      setShareLoading(false);
    }
  }

  // The two visibility controls below both used to fail in complete silence:
  // this one animated the switch on and back off within a few hundred
  // milliseconds, which is easy to miss entirely, and togglePrivacy gave no
  // motion at all to miss. These are controls over whether a security report
  // is publicly reachable, so a reverted change has to say so: the user's
  // reasonable belief otherwise is that the scan is now private when it is
  // still listed at /host/<hostname> and behind any share link.
  async function toggleSharePubliclyListed(next: boolean) {
    if (!scanId) return;
    setTogglingShareListing(true);
    const previous = sharePubliclyListed;
    setSharePubliclyListed(next); // optimistic
    const reportFailure = () => {
      setSharePubliclyListed(previous);
      toast({
        variant: "destructive",
        title: "Public listing unchanged",
        description: previous
          ? "This scan is still listed in Public Scans."
          : "This scan is still not listed in Public Scans.",
      });
    };
    try {
      const res = await fetch(
        `${API.HISTORY}/${scanId}/share/publicly-listed`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publiclyListed: next }),
        },
      );
      if (!res.ok) reportFailure();
    } catch {
      reportFailure();
    } finally {
      setTogglingShareListing(false);
    }
  }

  /**
   * Set or clear the share link's expiry. The same POST that creates a share
   * updates one in place: `expiresInDays` is 7, 30, 90, or null for never, and
   * an omitted field leaves whatever is stored alone. A lapsed link is
   * replaced with a fresh token by the route, so the returned token is read
   * back rather than assumed unchanged.
   */
  async function changeShareExpiry(days: number | null) {
    if (!scanId || updatingShareExpiry) return;
    setUpdatingShareExpiry(true);
    const previous = shareExpiresAt;
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: days }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setShareUrl(`${window.location.origin}/shared/${data.token}`);
        setShareExpiresAt(data.expiresAt ?? null);
      } else {
        setShareExpiresAt(previous);
        toast({
          variant: "destructive",
          title: "Link expiry unchanged",
          description: data.error || "That change did not go through.",
        });
      }
    } catch {
      setShareExpiresAt(previous);
      toast({
        variant: "destructive",
        title: "Link expiry unchanged",
        description: "Couldn't reach the server. Try again in a moment.",
      });
    } finally {
      setUpdatingShareExpiry(false);
    }
  }

  /**
   * Save the scan's whole team set.
   *
   * PATCH takes `teamIds` as a REPLACEMENT set, so every toggle sends the
   * complete list rather than a delta: there is then no way for the client's
   * idea of the share and the server's to drift apart, and the server can
   * authorize additions and removals in one pass. `changed` is only for the
   * toast, so it can name the team that was actually clicked.
   *
   * The modal stays open afterwards. It closed on every pick when the choice
   * was a radio button and there was nothing left to do; with a set, closing
   * after the first team would make sharing with a second one a fresh trip
   * through the menu.
   */
  async function saveTeams(
    next: number[],
    changed: { id: number | null; added: boolean },
  ) {
    if (!scanId || assigningTeam) return;
    setAssigningTeam(true);
    setPendingTeamId(changed.id);
    const teamName =
      changed.id === null
        ? null
        : (assignableTeams.find((t) => t.id === changed.id)?.name ??
          "that team");
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamIds: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAssignedTeamIds(data.teamIds ?? next);
        // The server just told us the assignment, so the picker never needs to
        // go and read it again on a later open.
        teamLoadedRef.current = true;
        setTeamLoadFailed(false);
        toast({
          title:
            changed.id === null
              ? "Removed from every team"
              : changed.added
                ? "Shared with team"
                : "Removed from the team",
          description:
            changed.id === null
              ? "This scan is back to being yours alone."
              : changed.added
                ? `Everyone on ${teamName} can open this scan from their history.`
                : `${teamName} can no longer open this scan.`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Team sharing unchanged",
          description: data.error || "That change did not go through.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Team sharing unchanged",
        description: "Couldn't reach the server. Try again in a moment.",
      });
    } finally {
      setAssigningTeam(false);
      setPendingTeamId(undefined);
    }
  }

  function toggleTeam(teamId: number) {
    const isOn = assignedTeamIds.includes(teamId);
    const next = isOn
      ? assignedTeamIds.filter((id) => id !== teamId)
      : [...assignedTeamIds, teamId];
    saveTeams(next, { id: teamId, added: !isOn });
  }

  async function togglePrivacy() {
    if (!scanId) return;
    const next = !currentIsPublic;
    setTogglingPrivacy(true);
    const reportFailure = (description: string) =>
      toast({
        variant: "destructive",
        title: "Visibility unchanged",
        description,
      });
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: next }),
      });
      if (res.ok) {
        onPrivacyChanged?.(next);
      } else {
        const data = await res.json().catch(() => ({}));
        reportFailure(
          data.error ||
            (currentIsPublic
              ? "This scan is still public."
              : "This scan is still private."),
        );
      }
    } catch {
      reportFailure(
        currentIsPublic
          ? "Couldn't reach the server. This scan is still public."
          : "Couldn't reach the server. This scan is still private.",
      );
    } finally {
      setTogglingPrivacy(false);
    }
  }

  async function fileGithubIssue() {
    if (githubFiling || !scanId) return;
    const repo = githubRepo.trim();
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
      setGithubError("Enter a repository as owner/name (e.g. octocat/site).");
      return;
    }
    setGithubFiling(true);
    setGithubError(null);
    try {
      const data = await apiPost<{ url: string }>(API.SCAN_GITHUB_ISSUE, {
        scanId,
        repo,
      });
      setGithubResult({ url: data.url });
    } catch (err) {
      setGithubError(
        err instanceof ApiError
          ? err.message
          : "Could not file the issue. Try again.",
      );
    } finally {
      setGithubFiling(false);
    }
  }

  async function openBrowserSession() {
    setViewError(null);
    setViewOpening(true);
    try {
      // No ttlSeconds: POST /api/v3/browser/sessions falls back to
      // BROWSERBASE_DEFAULT_TTL_SECONDS when the body omits it, and clamps
      // whatever it ends up with to BROWSERBASE_MAX_TTL_SECONDS. This used to
      // send a hardcoded 360, so an admin retuning the default setting changed
      // nothing for the one caller that actually opens sessions
      // (AUDIT-011#drift-21). The viewer still gets the real number back:
      // expiresInSeconds below comes from the route, not from this request.
      const res = await fetch(API.BROWSER_SESSIONS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: result.url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setViewError(
          data?.error ||
            `Could not start a browser session (HTTP ${res.status}).`,
        );
        return;
      }
      const id = data?.session?.id;
      if (!id) {
        setViewError("BrowserBase returned a session with no id.");
        return;
      }
      setViewOpen(false);
      const qs = new URLSearchParams();
      if (data?.expiresInSeconds)
        qs.set("expiresIn", String(data.expiresInSeconds));
      qs.set("url", result.url);
      const href = `${ROUTES.BROWSER(id)}?${qs.toString()}`;

      const a = document.createElement("a");
      a.href = href;
      a.target = isMobileBrowser() ? "_blank" : `vulnradar-browser-${id}`;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setViewError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setViewOpening(false);
    }
  }

  async function handleVerify() {
    if (!scanId) return;
    const controller = new AbortController();
    verifyAbortRef.current = controller;
    setVerifyError(null);
    setVerifiedFindings(null);
    setVerifyModalOpen(true);
    setVerifying(true);
    try {
      const data = await apiPost<{
        success: boolean;
        findings: Vulnerability[];
      }>(
        API.SCAN_VERIFY,
        { scanHistoryId: scanId },
        { signal: controller.signal },
      );
      if (Array.isArray(data.findings)) {
        setVerifiedFindings(data.findings);
        onVerified?.(data.findings);
      } else {
        setVerifyError("AI verification did not return any findings.");
      }
    } catch (err) {
      // Closing the modal aborts the request rather than just hiding it --
      // that's an intentional cancellation, not a failure worth surfacing.
      if (err instanceof Error && err.name === "AbortError") return;
      setVerifyError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the AI verification service.",
      );
    } finally {
      setVerifying(false);
    }
  }

  function handleVerifyModalOpenChange(nextOpen: boolean) {
    if (!nextOpen) verifyAbortRef.current?.abort();
    setVerifyModalOpen(nextOpen);
  }

  function handleSummaryModalOpenChange(nextOpen: boolean) {
    if (!nextOpen) summaryAbortRef.current?.abort();
    setSummaryModalOpen(nextOpen);
  }

  async function handleSummarize() {
    if (!scanId) return;
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setSummaryError(null);
    setSummaryModalOpen(true);
    setSummarizing(true);
    try {
      // A summary already on screen means this click is "Regenerate" (see
      // the menu label below) -- force the route past its cache short-circuit
      // so it calls the AI provider again instead of just handing back what
      // it already had.
      const isRegenerate = Boolean(summaryText);
      const data = await apiPost<{ success: boolean; summary: string }>(
        `${API.HISTORY}/${scanId}/summary${isRegenerate ? "?regenerate=true" : ""}`,
        undefined,
        { signal: controller.signal },
      );
      if (typeof data.summary === "string" && data.summary) {
        setSummaryText(data.summary);
        onSummaryGenerated?.(data.summary);
      } else {
        setSummaryError("AI summary did not return any text.");
      }
    } catch (err) {
      // Closing the modal aborts the request rather than just hiding it --
      // that's an intentional cancellation, not a failure worth surfacing.
      if (err instanceof Error && err.name === "AbortError") return;
      setSummaryError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the AI summary service.",
      );
    } finally {
      setSummarizing(false);
    }
  }

  async function handleDelete() {
    if (!scanId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiDelete(`${API.HISTORY}/${scanId}/delete`);
      setConfirmDelete(false);
      onDeleted?.();
    } catch (err) {
      // The dialog used to stay open with the spinner simply stopping, which
      // is indistinguishable from a slow delete that worked. Say what failed.
      setDeleteError(
        err instanceof ApiError
          ? err.message
          : "Couldn't delete this scan. It is still in your history.",
      );
      setDeleting(false);
    }
  }

  // BrowserBase sessions require an authenticated user (POST /api/v3/browser/sessions
  // 401s for anonymous callers) -- hide this entirely on a public page like
  // /shared/[token] rather than let a signed-out viewer click into a 401.
  const canView = Boolean(me) && /^https?:\/\//i.test(result.url.trim());
  // Compare reads the signed-in caller's own history, so there is nothing for
  // a signed-out viewer of a public report to diff against.
  const compareHost = me ? hostOf(result.url) : null;
  const canDelete = Boolean(scanId && isOwner && onDeleted);
  // Menu label for the share row. One team is named; several are counted,
  // because a menu row is not the place for a comma-separated team list.
  const assignedTeamLabel =
    assignedTeamIds.length === 0
      ? null
      : assignedTeamIds.length === 1
        ? `Shared with ${assignableTeams.find((t) => t.id === assignedTeamIds[0])?.name ?? "1 team"}`
        : `Shared with ${assignedTeamIds.length} teams`;
  // Teams the scan is shared with that the caller can no longer manage (they
  // were demoted, or left). They are still shown, checked and locked, rather
  // than left out: the picker would otherwise report a shared scan as shared
  // with nobody, and the PATCH gates removal on manage_scans in exactly the
  // same way it gates adding.
  const lockedTeamIds = assignedTeamIds.filter(
    (id) => !assignableTeams.some((t) => t.id === id),
  );
  const showAiReview = canOfferAiReview({
    scanId,
    aiAvailable,
    findings: result.findings,
  });
  // Unlike AI review (which hides once every finding has a verdict), a
  // one-paragraph scan summary stays offered indefinitely -- "Regenerate"
  // is a reasonable action even after one already exists.
  const showAiSummary = Boolean(scanId) && aiAvailable;

  // One entry per report format, all sharing the busy state so the menu says
  // which one is running instead of closing silently.
  const exportItem = (
    key: string,
    label: string,
    icon: PageActionItem["icon"],
    generate: () => string,
  ): PageActionEntry => ({
    key,
    label: exporting === key ? "Exporting..." : label,
    icon: exporting === key ? Loader2 : icon,
    onSelect: () => runExport(key, generate),
    disabled: exporting !== null,
  });

  const items: PageActionEntry[] = [
    exportItem("json", "Export as JSON", FileJson, exportJson),
    exportItem("csv", "Export as CSV", FileSpreadsheet, exportCsv),
    ...(featurePdfReports
      ? [exportItem("pdf", "Export as PDF", FileText, exportPdf)]
      : []),
    exportItem(
      "sarif",
      "Export as SARIF (GitHub Code Scanning)",
      FileCode2,
      exportSarif,
    ),
    exportItem("markdown", "Export as Markdown", FileType, exportMarkdown),
    // Every sibling here says the format it produces, and this one did not,
    // so "Compliance report" read as a rendered document rather than the raw
    // Markdown file it downloads. The audience for a compliance crosswalk is
    // the least likely to want a .md, so at minimum they should know before
    // they click.
    exportItem(
      "compliance",
      "Export compliance crosswalk (Markdown)",
      ShieldCheck,
      exportCompliance,
    ),
    { separator: true },
    ...(scanId
      ? ([
          {
            key: "share",
            label: shareLoading ? "Sharing..." : "Share this scan",
            icon: shareLoading ? Loader2 : Share2,
            onSelect: requestShare,
            disabled: shareLoading,
          },
        ] as PageActionEntry[])
      : []),
    // Find, fix, verify is the loop this product exists to serve, and verify
    // was the only leg with no direct route: Compare was linked from the nav
    // and the footer and from nowhere near a scan, so reaching a diff of the
    // host you were looking at meant six interactions with nothing
    // preselected. /compare?host= resolves the host's two most recent scans
    // and runs the diff on arrival.
    ...(compareHost
      ? ([
          {
            key: "compare",
            label: "Compare with previous scan",
            icon: GitCompareArrows,
            onSelect: () =>
              router.push(
                `${ROUTES.COMPARE}?host=${encodeURIComponent(compareHost)}`,
              ),
          },
        ] as PageActionEntry[])
      : []),
    ...(scanId && isOwner
      ? ([
          {
            key: "privacy",
            label: togglingPrivacy
              ? "Updating..."
              : currentIsPublic
                ? "Make private"
                : "Make public",
            icon: togglingPrivacy ? Loader2 : currentIsPublic ? Lock : Globe,
            onSelect: togglePrivacy,
            disabled: togglingPrivacy,
          },
          // One row, one modal. This used to render a row per assignable team
          // plus a "Stop sharing" row, so an account with a handful of teams
          // buried every other action in the menu under a team list.
          ...(assignableTeams.length > 0
            ? [
                {
                  key: "team-share",
                  label: assignedTeamLabel ?? "Share with a team",
                  icon: assigningTeam ? Loader2 : Users,
                  onSelect: () => setTeamModalOpen(true),
                  disabled: assigningTeam,
                },
              ]
            : []),
          ...(githubConnected
            ? [
                {
                  key: "github-issue",
                  label: "File as GitHub issue",
                  icon: CircleDot,
                  onSelect: () => {
                    setGithubError(null);
                    setGithubResult(null);
                    setGithubOpen(true);
                  },
                },
              ]
            : []),
        ] as PageActionEntry[])
      : []),
    ...(showAiReview
      ? ([
          {
            key: "ai-review",
            label: verifying ? "Verifying with AI..." : "Verify with AI",
            icon: verifying ? Loader2 : BotMessageSquare,
            onSelect: handleVerify,
            disabled: verifying,
          },
        ] as PageActionEntry[])
      : []),
    ...(showAiSummary
      ? ([
          {
            key: "ai-summary",
            label: summarizing
              ? "Summarizing..."
              : summaryText
                ? "Regenerate AI summary"
                : "Generate AI summary",
            icon: summarizing ? Loader2 : ScrollText,
            onSelect: handleSummarize,
            disabled: summarizing,
          },
        ] as PageActionEntry[])
      : []),
    ...(canView
      ? ([
          {
            key: "view",
            label: "View page in live browser",
            icon: Eye,
            onSelect: () => {
              setViewError(null);
              setViewOpen(true);
            },
          },
        ] as PageActionEntry[])
      : []),
    ...(canDelete
      ? ([
          { separator: true },
          {
            key: "delete",
            label: "Delete scan",
            icon: Trash2,
            onSelect: () => {
              setDeleteError(null);
              setConfirmDelete(true);
            },
            destructive: true,
          },
        ] as PageActionEntry[])
      : []),
  ];

  return (
    <>
      <PageActionsMenu items={items} label="Scan actions" />

      {shareUrl && (
        <ShareModal
          open={shareModalOpen}
          onOpenChange={setShareModalOpen}
          shareUrl={shareUrl}
          title={`${APP_NAME} Scan: ${result.url}`}
          publiclyListed={sharePubliclyListed}
          onPubliclyListedChange={toggleSharePubliclyListed}
          togglingPubliclyListed={togglingShareListing}
          expiresAt={shareExpiresAt}
          onExpiryChange={isOwner ? changeShareExpiry : undefined}
          updatingExpiry={updatingShareExpiry}
        />
      )}

      {/* Team picker. Replaces the row-per-team the menu used to render. Same
          shell tier and width rung as ShareModal: these two are the product's
          pair of "share this scan" modals and were reading as two unrelated
          controls. */}
      <Dialog open={teamModalOpen} onOpenChange={setTeamModalOpen}>
        <DialogContent variant="shell" size="sm">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <Users aria-hidden className="h-4 w-4 shrink-0 text-primary" />
              <DialogTitle>Share with a team</DialogTitle>
            </div>
            <DialogDescription>
              Pick as many teams as you like. Everyone on a team you tick can
              open this scan from their own history. Only teams where your role
              can manage scans are listed.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {teamLoading ? (
              <div role="status" className="flex flex-col gap-1.5">
                <span className="sr-only">
                  Checking which team this scan is shared with
                </span>
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    aria-hidden
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5"
                  >
                    <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-muted" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <div className="h-3 w-2/5 animate-pulse rounded-full bg-muted" />
                      <div className="h-2.5 w-1/4 animate-pulse rounded-full bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            ) : teamLoadFailed ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-6 text-center">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Couldn&apos;t check which team this scan is already on.
                  Picking one now could quietly replace a share you cannot see.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 bg-transparent"
                  onClick={() => setTeamReloadKey((k) => k + 1)}
                >
                  <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                  Try again
                </Button>
              </div>
            ) : assignableTeams.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-6 text-center">
                <Users aria-hidden className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  No team to share with
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Handing a scan to a team needs a role that can manage scans.
                  Ask an owner of one of your teams for it, or create a team of
                  your own from the Teams page.
                </p>
              </div>
            ) : (
              <div
                role="group"
                aria-label="Teams"
                className="flex flex-col gap-1.5"
              >
                {/* "Just me" is a row rather than a footer button so the list
                    always shows the scan's state, including "shared with
                    nobody". With the old ghost button, an unshared scan
                    rendered a group with nothing checked and a footer that
                    appeared and disappeared. It is the clear-all action now,
                    so it is inert once there is nothing left to clear. */}
                <TeamPickerRow
                  icon={Lock}
                  label="Just me"
                  meta={
                    assignedTeamIds.length === 0
                      ? "Not shared with any team."
                      : "Stop sharing with every team below."
                  }
                  selected={assignedTeamIds.length === 0}
                  pending={assigningTeam && pendingTeamId === null}
                  disabled={assigningTeam || assignedTeamIds.length === 0}
                  toggle={false}
                  onSelect={() => saveTeams([], { id: null, added: false })}
                />
                {assignableTeams.map((team) => (
                  <TeamPickerRow
                    key={team.id}
                    icon={Users}
                    label={team.name}
                    meta={teamPickerMeta(team)}
                    selected={assignedTeamIds.includes(team.id)}
                    pending={assigningTeam && pendingTeamId === team.id}
                    disabled={assigningTeam}
                    toggle
                    onSelect={() => toggleTeam(team.id)}
                  />
                ))}
                {lockedTeamIds.map((id) => (
                  <TeamPickerRow
                    key={`locked-${id}`}
                    icon={Users}
                    label={`Team #${id}`}
                    meta="Shared already. Your role there can no longer manage scans, so you cannot remove it."
                    selected
                    pending={false}
                    disabled
                    toggle
                    onSelect={() => {}}
                  />
                ))}
              </div>
            )}
          </DialogBody>

          <DialogFooter className="sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Every tick saves straight away.
            </p>
            <Button
              variant="outline"
              disabled={assigningTeam}
              onClick={() => setTeamModalOpen(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AiVerifyResultModal
        open={verifyModalOpen}
        onOpenChange={handleVerifyModalOpenChange}
        loading={verifying}
        error={verifyError}
        findings={verifiedFindings}
        pendingCount={result.findings.filter((f) => !f.aiVerdict).length}
      />

      <AiSummaryModal
        open={summaryModalOpen}
        onOpenChange={handleSummaryModalOpenChange}
        loading={summarizing}
        error={summaryError}
        summary={summaryText}
      />

      {/* Compact: two sentences and a pair of buttons. Bands here would be
          three dividers around nothing. */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Live browser session</DialogTitle>
            <DialogDescription>
              A secure remote browser opens and navigates to your target
              automatically. Nothing is saved to your account. Starts at 1
              minute, extendable to 5 minutes from the viewer.
            </DialogDescription>
          </DialogHeader>
          {viewError && <InlineAlert tone="error">{viewError}</InlineAlert>}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setViewOpen(false)}
              disabled={viewOpening}
            >
              Cancel
            </Button>
            <Button
              onClick={openBrowserSession}
              disabled={viewOpening}
              className="gap-2"
            >
              {viewOpening && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {viewOpening ? "Opening..." : "Open browser"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shell: this one has a form field, so the submit buttons stay pinned
          below it rather than scrolling away with a long error message. */}
      <Dialog open={githubOpen} onOpenChange={setGithubOpen}>
        <DialogContent variant="shell" size="sm">
          <DialogHeader>
            <DialogTitle>File as GitHub issue</DialogTitle>
            <DialogDescription>
              The VulnRadar GitHub Scanner opens an issue in one of your repos
              summarizing this scan&apos;s findings. Uses your connected GitHub
              account (repo access required).
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {githubResult ? (
              <div className="rounded-md border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 px-3 py-2.5 text-sm">
                <p className="text-foreground">Issue created.</p>
                <a
                  href={safeHref(githubResult.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline break-all"
                >
                  {githubResult.url}
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                <label
                  htmlFor="gh-issue-repo"
                  className="text-sm font-medium text-foreground"
                >
                  Repository
                </label>
                <Input
                  id="gh-issue-repo"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="owner/name"
                  autoComplete="off"
                  spellCheck={false}
                />
                {githubError && (
                  <p className="text-sm text-destructive">{githubError}</p>
                )}
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            {githubResult ? (
              <Button onClick={() => setGithubOpen(false)}>Done</Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setGithubOpen(false)}
                  disabled={githubFiling}
                >
                  Cancel
                </Button>
                <Button
                  onClick={fileGithubIssue}
                  disabled={githubFiling}
                  className="gap-2"
                >
                  {githubFiling && (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {githubFiling ? "Filing..." : "Create issue"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        danger
        busy={deleting}
        error={deleteError}
        title="Delete this scan?"
        description="This removes the scan, its findings, and any notes attached to it. This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
