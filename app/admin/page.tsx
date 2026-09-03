"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  Users,
  ShieldOff,
  RefreshCw,
  KeyRound,
  Loader2,
  ServerCrash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { cn } from "@/lib/ui/utils";
import { API, ROUTES } from "@/lib/config/client-constants";
import {
  ADMIN_NAV_GROUPS,
  VALID_TABS,
  canSeeAdminNavItem,
  type AdminNavItem,
  type AdminTabKey,
} from "@/components/admin/nav";
import {
  getAllQueryParams,
  setQueryParam,
  setQueryParams,
} from "@/lib/ui/url-state";
import {
  StatBarSkeleton,
  DataTableSkeleton,
  FactPanelSkeleton,
  HealthCardSkeleton,
  LogListSkeleton,
  PanelCardSkeleton,
  SettingsFieldsSkeleton,
  AdminMobileToc,
  AdminMobileSectionTrigger,
  type AdminTocItem,
  type SortDirection,
} from "@/components/admin/shared";
import { AdminDataSkeleton } from "@/components/admin/admin-skeleton";
import { ACTION_LABELS } from "@/components/admin/config";
import { hasStaffPermission, isStaffRole } from "@/lib/auth/permissions-client";
import { useAuth } from "@/components/providers/auth-provider";
import { resolveAdminGate } from "@/lib/admin/admin-gate";
import {
  buildHealthRows,
  worseState,
  worstHealthState,
  type HealthMetrics,
  type HealthState,
} from "@/components/admin/features/health-overview-utils";

// Matches queue-status-manager.tsx's own poll interval.
const HEALTH_POLL_INTERVAL_MS = 45_000;

// Import from new admin architecture
import type {
  AdminStats,
  AdminUser,
  UserDetail,
  AuditEntry,
  ActiveAdmin,
  BadgeDef,
  Team,
  TeamMember,
} from "@/components/admin/types";
import { Toast as AdminToast } from "@/components/admin/shared";
// Response envelopes for the admin API. Annotating each fetcher's
// res.json() with these turns a route that renames or drops an envelope key
// into a compile error instead of a runtime undefined.
import type {
  AdminUsersResponse,
  AdminAuditResponse,
  AdminStaffResponse,
  AdminTeamsResponse,
  AdminTeamDetailResponse,
  AdminUserDetailResponse,
  AdminBadgesResponse,
  AdminActionResponse,
  TeamRenameResponse,
  TeamDeleteResponse,
} from "@/components/admin/types.responses";

// Every tab panel is code-split. All of them used to be static imports, so
// one /admin visit downloaded and parsed ~1.3 MB of JavaScript (the second
// heaviest route in the build) to render exactly one panel; user-detail-panel
// alone is 2,900 lines, staff-list 1,200, notifications-manager 1,100. Only
// one panel renders at a time behind its `activeTab === ...` guard, so the
// rest are fetched on demand. ssr:false because this whole page is a client
// component behind an auth gate: there is nothing to server-render.
//
// The `loading` fallback is what actually renders on every visit to a tab, so
// it matters more than app/admin/loading.tsx. It used to be one hardcoded
// shape for all seventeen tabs: a four-cell stat strip over an avatar table,
// with no panel header, inside a second border the panel does not have. Nine
// tabs have no stat strip at all (the strip simply vanished), five have a
// different cell count, and the five that own a purpose-built skeleton showed
// three different shapes on the way to their content. Each panel now names its
// own shape.
const panel = (
  load: () => Promise<{ default: React.ComponentType }>,
  shape: PanelShape = {},
): React.ComponentType =>
  dynamic(load, { ssr: false, loading: () => <PanelSkeleton {...shape} /> });

interface PanelShape {
  /** Cells in the panel's stat strip, or one entry per strip for the panels
   *  that stack two (the user directory does). Omitted means no strip. */
  stats?: number | number[];
  /** The panel's header carries a search field or filter row. */
  filterRow?: boolean;
  /** Body below the strip. Defaults to the six-row data table. */
  body?: "table" | "settings" | "logs" | "none";
  /** Panels that open with a fact grid (Backups, Updater). Set, this renders
   *  the exact skeleton those panels show once mounted, so the sequence is one
   *  shape rather than a table on the way to a fact grid. */
  facts?: number;
}

function PanelSkeleton({
  stats,
  filterRow,
  body = "table",
  facts,
}: PanelShape) {
  // A fact grid is a whole panel shape rather than a body variant, so it
  // replaces everything below rather than sitting inside the Card.
  return facts !== undefined ? (
    <FactPanelSkeleton facts={facts} />
  ) : (
    <div className="space-y-4">
      {/* The strip sits above the Card, which is where every panel that has
          one puts it (see components/admin/users/users-tab.tsx). */}
      {stats !== undefined && (
        <div className="space-y-3">
          {(Array.isArray(stats) ? stats : [stats]).map((segments, i) => (
            <StatBarSkeleton key={i} segments={segments} />
          ))}
        </div>
      )}
      <PanelCardSkeleton withFilterRow={filterRow}>
        {body === "table" && <DataTableSkeleton rows={6} bordered={false} />}
        {body === "settings" && (
          <div className="p-4 sm:p-5">
            <SettingsFieldsSkeleton />
          </div>
        )}
        {body === "logs" && <LogListSkeleton />}
      </PanelCardSkeleton>
    </div>
  );
}

const IPRulesManager = panel(
  () =>
    import("@/components/admin/features/ip-rules-manager").then((m) => ({
      default: m.IPRulesManager,
    })),
  { stats: 4, filterRow: true },
);
const BlockedDataManager = panel(
  () =>
    import("@/components/admin/features/blocked-data-manager").then((m) => ({
      default: m.BlockedDataManager,
    })),
  { stats: 3, filterRow: true },
);
const ContentManager = panel(
  () =>
    import("@/components/admin/features/content-manager").then((m) => ({
      default: m.ContentManager,
    })),
  { filterRow: true },
);
const SecurityAlertsManager = panel(
  () =>
    import("@/components/admin/features/security-alerts-manager").then((m) => ({
      default: m.SecurityAlertsManager,
    })),
  { stats: 5 },
);
const SystemSettingsManager = panel(
  () =>
    import("@/components/admin/features/system-settings-manager").then((m) => ({
      default: m.SystemSettingsManager,
    })),
  { body: "settings", filterRow: true },
);
const MassEmailManager = panel(
  () =>
    import("@/components/admin/features/mass-email-manager").then((m) => ({
      default: m.MassEmailManager,
    })),
  { stats: 3 },
);
const AIChatsManager = panel(
  () =>
    import("@/components/admin/features/ai-chats-manager").then((m) => ({
      default: m.AIChatsManager,
    })),
  { stats: 4, filterRow: true },
);
// Its own two-pane layout, so nothing below the header is a table.
const SupportInbox = panel(
  () =>
    import("@/components/admin/features/support-inbox").then((m) => ({
      default: m.SupportInbox,
    })),
  { body: "none" },
);
// Updater and Backups open with a fact grid, and each already renders its own
// FactPanelSkeleton once mounted. Drawing a stat strip over a table here made
// the load sequence three shapes deep; the same fact grid makes it one.
const UpdaterManager = panel(
  () =>
    import("@/components/admin/features/updater-manager").then((m) => ({
      default: m.UpdaterManager,
    })),
  { facts: 4 },
);
const BackupManager = panel(
  () =>
    import("@/components/admin/features/backup-manager").then((m) => ({
      default: m.BackupManager,
    })),
  { facts: 3 },
);
const ErrorLogsManager = panel(
  () =>
    import("@/components/admin/features/error-logs-manager").then((m) => ({
      default: m.ErrorLogsManager,
    })),
  { body: "logs", filterRow: true },
);
const EmailLogsManager = panel(
  () =>
    import("@/components/admin/features/email-logs-manager").then((m) => ({
      default: m.EmailLogsManager,
    })),
  { body: "logs", filterRow: true },
);
const EngineFeedbackManager = panel(() =>
  import("@/components/admin/features/engine-feedback-manager").then((m) => ({
    default: m.EngineFeedbackManager,
  })),
);
const QueueStatusManager = panel(
  () =>
    import("@/components/admin/features/queue-status-manager").then((m) => ({
      default: m.QueueStatusManager,
    })),
  { stats: 4, body: "none" },
);
const BillingOverviewManager = panel(
  () =>
    import("@/components/admin/features/billing-overview-manager").then(
      (m) => ({
        default: m.BillingOverviewManager,
      }),
    ),
  { stats: 5 },
);
const HealthOverview = dynamic(
  () =>
    import("@/components/admin/features/health-overview").then((m) => ({
      default: m.HealthOverview,
    })),
  // Overview is the tab the panel lands on, so this fallback is the first
  // thing anyone opening /admin sees. PanelSkeleton (a stat strip over a
  // table) is the shape of the tab this one replaced, so the load sequence
  // drew counters and a table on the way to a status list.
  { ssr: false, loading: () => <HealthCardSkeleton /> },
);

// These four take props, so they keep their own typed dynamic() calls rather
// than going through the prop-less `panel` helper above.
const NotificationsManager = dynamic(
  () =>
    import("@/components/admin/notifications").then((m) => ({
      default: m.NotificationsManager,
    })),
  { ssr: false, loading: () => <PanelSkeleton {...{ stats: 4 }} /> },
);
const UserDetailPanel = dynamic(
  () =>
    import("@/components/admin/users").then((m) => ({
      default: m.UserDetailPanel,
    })),
  { ssr: false, loading: () => <PanelSkeleton {...{ body: "none" }} /> },
);
// Imported from its own path rather than the components/admin/users barrel:
// the barrel would pull the 2,900-line user-detail-panel into the same chunk
// as the directory table, which is the opposite of what code-splitting these
// panels was for.
const UsersTab = dynamic(
  () =>
    import("@/components/admin/users/users-tab").then((m) => ({
      default: m.UsersTab,
    })),
  {
    ssr: false,
    loading: () => <PanelSkeleton {...{ stats: [5, 5], filterRow: true }} />,
  },
);
const AuditLog = dynamic(
  () =>
    import("@/components/admin/audit").then((m) => ({ default: m.AuditLog })),
  {
    ssr: false,
    loading: () => <PanelSkeleton {...{ stats: 4, filterRow: true }} />,
  },
);
const StaffList = dynamic(
  () =>
    import("@/components/admin/staff").then((m) => ({ default: m.StaffList })),
  { ssr: false, loading: () => <PanelSkeleton {...{ stats: 5 }} /> },
);
const TeamsList = dynamic(
  () =>
    import("@/components/admin/teams").then((m) => ({ default: m.TeamsList })),
  { ssr: false, loading: () => <PanelSkeleton {...{ filterRow: true }} /> },
);

// Derived from VALID_TABS in components/admin/nav.ts rather than hand-
// maintained: it used to be a 21-member union repeating that tuple verbatim,
// so the two could disagree about which destinations exist.
type ActiveTab = AdminTabKey;

type TeamMembersState = {
  team: Team;
  members: TeamMember[];
};

export default function AdminPage() {
  return <AdminContent />;
}

function AdminContent() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [twoFactorLockout, setTwoFactorLockout] = useState(false);
  // Terminal state for a server fault, kept separate from `forbidden` so a
  // 500 or a dropped connection never renders as "Access Denied". 0 means the
  // request never completed (network error / non-JSON body).
  const [loadFailedStatus, setLoadFailedStatus] = useState<number | null>(null);
  // Client-side auth (cached role) so an obvious non-staff visitor is denied
  // before the admin data request would flash the skeleton. The server's 403
  // stays authoritative on top; see resolveAdminGate.
  const { me, isLoading: authLoading } = useAuth();
  const viewerIsStaff = isStaffRole(me?.role);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  // Lands on the health overview, not the user directory. AUDIT-014
  // qols-02: "is anything wrong right now" used to cost six clicks through
  // six panels, so it was the check that got skipped.
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(10);
  const [teams, setTeams] = useState<
    {
      id: number;
      name: string;
      slug: string;
      created_at: string;
      owner_id: number;
      owner_email: string;
      owner_name: string | null;
      owner_avatar_url: string | null;
      member_count: number;
    }[]
  >([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsPage, setTeamsPage] = useState(1);
  const [teamsTotalPages, setTeamsTotalPages] = useState(1);
  const [teamsPageSize, setTeamsPageSize] = useState(10);
  const [teamsSearch, setTeamsSearch] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMembersState | null>(null);
  const [teamMembersLoading, setTeamMembersLoading] = useState(false);
  const [activeAdmins, setActiveAdmins] = useState<ActiveAdmin[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [callerRole, setCallerRole] = useState<string>("user");
  const [auditPaging, setAuditPaging] = useState(false);
  const [allBadges, setAllBadges] = useState<BadgeDef[]>([]);
  const [userSort, setUserSort] = useState<{
    column: "name" | "joined" | null;
    direction: SortDirection;
  }>({ column: null, direction: null });
  const [updateAvailable, setUpdateAvailable] = useState(false);
  // Health lives at the page level rather than inside the overview panel so
  // the worst state can be mirrored onto the nav item as a coloured dot: an
  // operator sitting on any other tab still sees that something went red.
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthRefreshing, setHealthRefreshing] = useState(false);
  const [healthFailed, setHealthFailed] = useState(false);
  // Read at fire time by fetchData, which is a stable useCallback with no
  // deps: without the ref, paging or searching would drop the active sort.
  const userSortRef = useRef<{
    column: "name" | "joined" | null;
    direction: SortDirection;
  }>({ column: null, direction: null });
  const teamsSearchInitRef = useRef(false);
  const fetchTeamsRef = useRef<
    ((p?: number, search?: string, limit?: number) => Promise<void>) | null
  >(null);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
    },
    [],
  );

  // Sync user/tab selection with URL query params
  const updateUrlWithUser = useCallback(
    (userId: number | null, tab?: string, replace = true) => {
      const updates: Record<string, string | null> = {};
      if (tab) updates.tab = tab;
      else updates.tab = null;
      // admin: bare user id is unambiguous in this scope (the only
      // param set when on the users tab is the user id), so we just
      // use the number directly. Reads back as `parseInt(user, 10)`.
      updates.user = userId ? String(userId) : null;
      const opts = { replace } as { replace: boolean };
      const keys = Object.keys(updates);
      if (keys.length === 0) return;
      if (keys.length === 1) {
        setQueryParam(keys[0], updates[keys[0]], opts);
      } else {
        setQueryParams(updates, opts);
      }
    },
    [],
  );

  // FETCH FUNCTIONS - must be defined before handleHashChange
  const fetchData = useCallback(
    async (
      p: number,
      search: string,
      isInitial: boolean,
      limit: number,
      sort?: { column: "name" | "joined" | null; direction: SortDirection },
    ) => {
      if (isInitial) setLoading(true);
      else setSearchLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(limit),
        });
        if (search.trim()) params.set("search", search.trim());
        // Sort is applied by the server across the whole table. Passed as an
        // argument rather than read from state so the header control can
        // refetch with its new value before the state update commits.
        const activeSort = sort ?? userSortRef.current;
        if (activeSort.column && activeSort.direction) {
          params.set("sort", activeSort.column);
          params.set("dir", activeSort.direction);
        }
        const res = await fetch(`${API.ADMIN}?${params}`);
        if (res.status === 403) {
          const data = await res.json().catch(() => null);
          if (data?.code === "2fa_required") setTwoFactorLockout(true);
          setForbidden(true);
          setLoading(false);
          setSearchLoading(false);
          return;
        }
        // Anything else that is not ok is a server fault, not an
        // authorization one. It used to fall through to res.json() and land
        // in the catch below, which called setForbidden(true) and told the
        // operator their account lacked permission during an outage: the
        // wrong debugging path, with no retry and no status code anywhere.
        if (!res.ok) {
          setLoadFailedStatus(res.status);
          setLoading(false);
          setSearchLoading(false);
          return;
        }
        const data: AdminUsersResponse | null = await res
          .json()
          .catch(() => null);
        if (!data) {
          setLoadFailedStatus(res.status);
          setLoading(false);
          setSearchLoading(false);
          return;
        }
        setLoadFailedStatus(null);
        setStats(data.stats);
        setUsers(data.users);
        setPage(data.page);
        setTotalPages(data.totalPages);
        if (data.callerRole) setCallerRole(data.callerRole);
      } catch (error) {
        console.error("Failed to fetch admin data", error);
        setLoadFailedStatus(0);
      }
      setLoading(false);
      setSearchLoading(false);
    },
    [],
  );

  const fetchAudit = useCallback(
    async (p = 1, limit = auditPageSize) => {
      setAuditPaging(true);
      try {
        const res = await fetch(
          `${API.ADMIN}?section=audit&page=${p}&limit=${limit}`,
        );
        const data: AdminAuditResponse = await res.json();
        setAuditLogs(data.logs);
        setAuditPage(data.page);
        setAuditTotalPages(data.totalPages);
      } catch (error) {
        console.error("Failed to fetch audit logs", error);
      }
      setAuditPaging(false);
    },
    [auditPageSize],
  );

  const fetchActiveAdmins = useCallback(async () => {
    setAdminsLoading(true);
    try {
      const res = await fetch(`${API.ADMIN}?section=active-admins`);
      const data: AdminStaffResponse = await res.json();
      setActiveAdmins(data.admins || []);
    } catch (error) {
      console.error("Failed to fetch active admins", error);
    }
    setAdminsLoading(false);
  }, []);

  const fetchTeams = useCallback(
    async (p = 1, search?: string, limit = teamsPageSize) => {
      setTeamsLoading(true);
      try {
        // limit follows the page-size selector. It used to be hardcoded to
        // "10", so picking 50 highlighted the button and still returned 10.
        // Taken as an argument as well as from state so the selector can
        // pass its new value before the state update has committed.
        const params = new URLSearchParams({
          page: String(p),
          limit: String(limit),
        });
        const searchTerm = search !== undefined ? search : teamsSearch;
        if (searchTerm.trim()) params.set("search", searchTerm.trim());
        const res = await fetch(`/api/v3/admin/teams?${params}`);
        const data: AdminTeamsResponse = await res.json();
        setTeams(data.teams || []);
        setTeamsPage(data.page || 1);
        setTeamsTotalPages(data.totalPages || 1);
      } catch {
        /* ignore */
      }
      setTeamsLoading(false);
    },
    [teamsSearch, teamsPageSize],
  );

  // Keep ref in sync with latest fetchTeams so debounced effect can call it
  // without re-running on every callback recreation.
  useEffect(() => {
    fetchTeamsRef.current = fetchTeams;
  }, [fetchTeams]);

  const fetchUserDetail = useCallback(
    async (userId: number, skipUrlUpdate = false) => {
      setDetailLoading(true);
      try {
        const res = await fetch(
          `${API.ADMIN}?section=user-detail&userId=${userId}`,
        );
        const data: AdminUserDetailResponse = await res.json();
        setSelectedUser(data);
        if (!skipUrlUpdate) updateUrlWithUser(userId, activeTab, false);
      } catch {
        showToast("Failed to load user details.", "error");
      }
      setDetailLoading(false);
    },
    [activeTab, updateUrlWithUser, showToast],
  );

  const fetchHealth = useCallback(async (isInitial = false) => {
    if (isInitial) setHealthLoading(true);
    else setHealthRefreshing(true);
    try {
      const res = await fetch("/api/v3/admin/health");
      if (res.ok) {
        setHealth((await res.json()) as HealthMetrics);
        setHealthFailed(false);
      } else {
        setHealthFailed(true);
      }
    } catch {
      setHealthFailed(true);
    }
    setHealthLoading(false);
    setHealthRefreshing(false);
  }, []);

  const fetchAllBadges = useCallback(async () => {
    try {
      const res = await fetch(`${API.ADMIN}?section=badges`);
      if (res.ok) {
        const data: AdminBadgesResponse = await res.json();
        setAllBadges(data.badges || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Parse query params and load corresponding data
  const handleQueryChange = useCallback(() => {
    if (typeof window === "undefined") return;
    const params = getAllQueryParams();
    const tab = params.tab;
    const user = params.user;
    if (!tab && !user) {
      setQueryParam("tab", "overview", { replace: true });
      setSelectedUser(null);
      return;
    }

    let foundUser = false;
    if (tab && VALID_TABS.includes(tab as (typeof VALID_TABS)[number])) {
      setActiveTab(tab as typeof activeTab);
      if (tab === "audit") fetchAudit();
      if (tab === "admins") fetchActiveAdmins();
      if (tab === "teams") fetchTeams();
    }
    if (user && user !== "") {
      const id = parseInt(user, 10);
      if (!isNaN(id) && id > 0) {
        fetchUserDetail(id, true);
        foundUser = true;
      }
    }
    if (!foundUser) setSelectedUser(null);
  }, [fetchAudit, fetchActiveAdmins, fetchTeams, fetchUserDetail]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL's query string (an external system) to seed tab/filter state, then subscribes to popstate for back/forward navigation
    handleQueryChange();
    window.addEventListener("popstate", handleQueryChange);
    return () => window.removeEventListener("popstate", handleQueryChange);
  }, [handleQueryChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-tab-change: setState only fires after the request resolves, not synchronously in this effect
    if (activeTab === "audit") fetchAudit();
    if (activeTab === "admins") fetchActiveAdmins();
  }, [activeTab, fetchActiveAdmins, fetchAudit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchData(1, "", true, 10);
    fetchAllBadges();
    fetchHealth(true);
    // Lightweight, once-per-page-load check so the "Updater" nav item can
    // show a dot without every admin having to open that tab first.
    fetch("/api/v3/admin/updater/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUpdateAvailable(data?.status === "behind"))
      .catch(() => {});
  }, [fetchData, fetchAllBadges, fetchHealth]);

  // Same cadence as queue-status-manager's own poll. Cheap: seven bounded
  // aggregates in one request, and it is what keeps the nav dot honest while
  // the operator is sitting on another tab. Not started for a visitor the
  // server already refused: the deny screen has no dot to keep honest, and
  // polling a 403 every 45 seconds for as long as that tab stays open is
  // pure noise in the rate limiter and the logs.
  useEffect(() => {
    if (forbidden) return;
    const timer = setInterval(
      () => fetchHealth(false),
      HEALTH_POLL_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [fetchHealth, forbidden]);

  async function fetchTeamMembers(teamId: number) {
    setTeamMembersLoading(true);
    try {
      const res = await fetch(`/api/v3/admin/teams/${teamId}`);
      const data: AdminTeamDetailResponse = await res.json();
      setTeamMembers(data);
    } catch {
      showToast("Failed to load team members", "error");
    }
    setTeamMembersLoading(false);
  }

  async function handleTeamRename(teamId: number, newName: string) {
    setActionLoading(`team-rename-${teamId}`);
    try {
      const res = await fetch(`/api/v3/admin/teams`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, name: newName }),
      });
      if (res.ok) {
        showToast("Team renamed successfully", "success");
        fetchTeams(teamsPage);
      } else {
        const data: TeamRenameResponse = await res.json();
        showToast(data.error || "Failed to rename team", "error");
      }
    } catch {
      showToast("Failed to rename team", "error");
    }
    setActionLoading(null);
  }

  async function handleTeamDelete(teamId: number) {
    setActionLoading(`team-delete-${teamId}`);
    try {
      const res = await fetch(`/api/v3/admin/teams`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (res.ok) {
        showToast("Team deleted successfully", "success");
        fetchTeams(teamsPage);
      } else {
        const data: TeamDeleteResponse = await res.json();
        showToast(data.error || "Failed to delete team", "error");
      }
    } catch {
      showToast("Failed to delete team", "error");
    }
    setActionLoading(null);
  }

  async function handleAction(
    userId: number,
    action: string,
    extra?: Record<string, unknown>,
    // `toast` lets a batched caller collapse N per-item toasts into one
    // summary: the badge multi-select in user-detail-panel commits up to a
    // dozen award/revoke PATCHes in one save and used to fire a separate
    // "Badge awarded." for each, which stacked and told the operator nothing
    // about the batch as a whole. Pass a string to override the label, or
    // false to stay silent. Not part of `extra`, which is sent as request body.
    options?: { toast?: string | false },
  ): Promise<{
    ok: boolean;
    error?: string;
    change?: { field: string; oldValue: string; newValue: string };
  }> {
    setActionLoading(`${userId}-${action}`);
    let result: {
      ok: boolean;
      error?: string;
      change?: { field: string; oldValue: string; newValue: string };
    } = { ok: false };
    try {
      const res = await fetch(API.ADMIN, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action, ...extra }),
      });
      const data: AdminActionResponse = await res.json();
      if (res.ok) {
        if (action === "create_badge" || action === "delete_badge") {
          fetchAllBadges();
        }
        // ACTION_LABELS lives in components/admin/config.ts. This used to be
        // an inlined duplicate that had drifted ahead of the exported one, so
        // a label added in the obvious place never appeared.
        if (options?.toast !== false) {
          showToast(
            options?.toast || ACTION_LABELS[action] || "Action completed.",
            "success",
          );
        }
        // Skip refetch for badge award/revoke - onBadgesChanged handles optimistic UI update
        if (action !== "award_badge" && action !== "revoke_badge") {
          await fetchData(page, searchQuery, false, usersPageSize);
          if (selectedUser && selectedUser.user.id === userId) {
            if (action === "delete") {
              setSelectedUser(null);
              updateUrlWithUser(null, activeTab);
            } else await fetchUserDetail(userId);
          }
        }
        result = { ok: true, change: data.change };
      } else {
        showToast(data.error || "Action failed.", "error");
        result = { ok: false, error: data.error };
      }
    } catch {
      showToast("Action failed.", "error");
      result = { ok: false, error: "Action failed." };
    }
    setActionLoading(null);
    return result;
  }

  const searchInitRef = useRef(false);

  // Debounced server-side search
  useEffect(() => {
    if (!searchInitRef.current) {
      searchInitRef.current = true;
      return;
    }
    setSearchLoading(true);
    const timeout = setTimeout(async () => {
      try {
        // Carry the chosen page size; omitting it made the server fall back to
        // its default while the pagination control still showed usersPageSize,
        // so totalPages was recomputed for the wrong size.
        const params = new URLSearchParams({
          page: "1",
          limit: String(usersPageSize),
        });
        if (searchQuery.trim()) params.set("search", searchQuery.trim());
        const res = await fetch(`${API.ADMIN}?${params}`);
        if (res.ok) {
          const data = await res.json();
          setUsers(data.users);
          setPage(data.page);
          setTotalPages(data.totalPages);
        }
      } catch {
        /* ignore */
      }
      setSearchLoading(false);
    }, 300);
    return () => {
      clearTimeout(timeout);
      setSearchLoading(false);
    };
    // usersPageSize is read at fire time but intentionally not a dep: a page-size
    // change has its own fetch handler, so listing it here would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Debounced teams search
  useEffect(() => {
    if (!teamsSearchInitRef.current) {
      teamsSearchInitRef.current = true;
      return;
    }
    setTeamsLoading(true);
    const timeout = setTimeout(() => {
      fetchTeamsRef.current?.(1, teamsSearch);
    }, 300);
    return () => {
      clearTimeout(timeout);
      setTeamsLoading(false);
    };
  }, [teamsSearch]);

  // The rows exactly as the server ordered them. This used to be a
  // client-side memo that sorted only the page already on screen while the
  // header control looked like a real sort, so clicking "Joined" on page 1
  // of 40 answered "oldest of these ten", not "oldest account".
  const sortedUsers = users;

  const toggleUserSort = (column: "name" | "joined") => {
    const next: { column: "name" | "joined" | null; direction: SortDirection } =
      userSort.column !== column
        ? { column, direction: "asc" }
        : userSort.direction === "asc"
          ? { column, direction: "desc" }
          : { column: null, direction: null };
    setUserSort(next);
    userSortRef.current = next;
    // Back to page 1: the row that was on page 3 under the old order is not
    // on page 3 under the new one.
    fetchData(1, searchQuery, false, usersPageSize, next);
  };

  // Every item below carries either `permission` (checked against the
  // exact STAFF_PERMISSIONS grant its route enforces server-side) or
  // `minHierarchy` (for the handful of routes still gated by a raw
  // role-hierarchy floor, e.g. requireModerator()) -- so a specialist role
  // never sees a tab here that its own API call then 403s. Items with
  // neither are visible to anyone who reached this page at all (baseline
  // ACCESS_ADMIN_PANEL). See lib/auth/permissions-client.ts's
  // ROLE_PERMISSION_MAP for what billing/security_analyst/content_manager/
  // ops each actually hold.
  //
  // Declared here (before the forbidden/loading early returns below)
  // rather than after them: handleTabChange and the tab-redirect effect
  // both need to be called unconditionally on every render, so everything
  // they close over has to live above those returns too, or the redirect
  // effect would violate rules-of-hooks (a different hook count on a
  // forbidden/loading render vs. a loaded one).
  // The destination table itself lives in components/admin/nav.ts, along with
  // the reasoning for how the groups are cut. It used to be written out here
  // three times over (VALID_TABS, the ActiveTab union, NAV_GROUPS_RAW) with
  // nothing tying the three together. Only the per-role filtering is local,
  // because only that depends on callerRole.
  const NAV_GROUPS = ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      canSeeAdminNavItem(item, callerRole, hasStaffPermission),
    ),
  })).filter((group) => group.items.length > 0);

  const ALL_ADMIN_TABS: AdminNavItem[] = NAV_GROUPS.flatMap((g) => g.items);

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey as typeof activeTab);
    if (tabKey === "audit") fetchAudit();
    if (tabKey === "admins") fetchActiveAdmins();
    if (tabKey === "teams") fetchTeams();
    setSelectedUser(null);
    updateUrlWithUser(null, tabKey, false);
  };

  // "users" is the hardcoded initial activeTab, but a specialist role
  // without VIEW_USERS (e.g. ops) never sees a "Users" nav entry -- land
  // them on the first tab their own role's permissions actually grant
  // instead of a nav with nothing highlighted. Waits for `loading` to
  // clear (callerRole defaults to "user" until fetchData's response sets
  // the real value) so this can't fire against a not-yet-resolved role
  // and redirect somewhere wrong on the very first render. Declared before
  // the early returns below, and safe to run on a forbidden/loading
  // render too (ALL_ADMIN_TABS is empty until data loads, so the guard
  // clause is always hit on those renders).
  useEffect(() => {
    if (loading || ALL_ADMIN_TABS.length === 0) return;
    if (ALL_ADMIN_TABS.some((t) => t.key === activeTab)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time redirect off a tab this role can't see, gated by the ALL_ADMIN_TABS.some() check above so it can't loop
    handleTabChange(ALL_ADMIN_TABS[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, callerRole]);

  const gate = resolveAdminGate({
    forbidden,
    authLoading,
    viewerIsStaff,
    dataLoading: loading,
  });

  // Server fault, not an authorization one. Shown only to a viewer whose
  // cached role already says staff, so a non-staff visitor still gets the
  // deny screen below rather than a hint that the panel exists.
  if (loadFailedStatus !== null && !forbidden && viewerIsStaff) {
    return (
      <AppPageShell fullBleed className="flex items-center justify-center px-4">
        <div className="text-center flex flex-col items-center gap-4">
          <div className="h-14 w-14 rounded-lg bg-destructive/10 flex items-center justify-center">
            <ServerCrash className="h-7 w-7 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Couldn&apos;t load the admin panel
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              The admin data request failed. This is a server or network
              problem, not a permissions one, so your account is fine.
            </p>
            <p className="text-xs font-mono text-muted-foreground mt-2">
              {loadFailedStatus === 0
                ? "no response"
                : `HTTP ${loadFailedStatus}`}
            </p>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => {
              setLoadFailedStatus(null);
              fetchData(page, searchQuery, true, usersPageSize);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </AppPageShell>
    );
  }

  // Access denied: the server returned 403, or the client's own cached role
  // already shows this viewer is not staff (so the skeleton never flashes).
  if (gate === "deny") {
    return (
      <AppPageShell fullBleed className="flex items-center justify-center px-4">
        <div className="text-center flex flex-col items-center gap-4">
          <div className="h-14 w-14 rounded-lg bg-destructive/10 flex items-center justify-center">
            {twoFactorLockout ? (
              <KeyRound className="h-7 w-7 text-destructive" />
            ) : (
              <ShieldOff className="h-7 w-7 text-destructive" />
            )}
          </div>
          {twoFactorLockout ? (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Two-Factor Authentication Required
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                This instance requires 2FA for staff accounts, and yours
                isn&apos;t set up yet. Enable it in your account settings to
                regain access to the admin panel.
              </p>
            </div>
          ) : (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Access Denied
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                You do not have administrator privileges to access this panel.
              </p>
            </div>
          )}
          {twoFactorLockout ? (
            <Button asChild size="sm" className="h-8 gap-1.5">
              <a href={`${ROUTES.PROFILE}?tab=security`}>
                Set Up Two-Factor Authentication
              </a>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
              <a href={ROUTES.DASHBOARD}>Back to Scanner</a>
            </Button>
          )}
        </div>
      </AppPageShell>
    );
  }

  // Auth still resolving for a viewer we cannot yet confirm as staff: a
  // neutral loader, never the admin skeleton, so nothing admin-shaped shows
  // before a possible deny.
  if (gate === "auth-pending") {
    return (
      <AppPageShell fullBleed className="flex items-center justify-center px-4">
        <Loader2
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <span className="sr-only">Loading</span>
      </AppPageShell>
    );
  }

  // The panel body, and only the panel body, waits: the sidebar is filtered by
  // callerRole and the health card needs its own request. The title block
  // above them is static, so it renders on the first frame rather than being
  // torn down and redrawn as grey once the data lands.
  const panelLoading = gate === "loading";

  const activeTabMeta = ALL_ADMIN_TABS.find((t) => t.key === activeTab);

  // Worst health state, mirrored onto the Overview nav item so a fault is
  // visible from whichever tab the operator happens to be on. Amber and red
  // only: a green dot on a healthy panel is noise.
  const healthRows = buildHealthRows(health, { updateAvailable });
  const worstHealth = worstHealthState(healthRows);
  const healthProblemCount = healthRows.filter(
    (r) => r.state === "crit" || r.state === "warn",
  ).length;
  // ...and the same state mirrored onto the destination each row drills into,
  // so the nav says WHICH tab is unhealthy rather than only that something is.
  // Every health row already carries the tab that owns it (that is how the
  // Overview list links out), so this costs nothing beyond the reduce. Two
  // rows can share a tab (scanner queue and failed scans both point at
  // queue-status), hence worseState rather than last-write-wins.
  const healthByTab = healthRows.reduce<Record<string, HealthState>>(
    (acc, row) => {
      acc[row.tab] =
        acc[row.tab] === undefined
          ? row.state
          : worseState(acc[row.tab], row.state);
      return acc;
    },
    {},
  );

  // Site-wide section list for the mobile drawer, grouped the same way
  // NAV_GROUPS groups the desktop sidebar.
  const mobileSectionItems: AdminTocItem[] = NAV_GROUPS.reduce<AdminTocItem[]>(
    (acc, group) => [
      ...acc,
      ...group.items.map((tab) => {
        const state =
          tab.key === "overview" ? worstHealth : healthByTab[tab.key];
        return {
          id: tab.key,
          label: tab.label,
          group: group.label,
          active: activeTab === tab.key,
          status:
            state === "crit"
              ? ("crit" as const)
              : state === "warn"
                ? ("warn" as const)
                : undefined,
          onSelect: () => handleTabChange(tab.key),
        };
      }),
    ],
    [],
  );

  return (
    // max-w-6xl (AppPageShell's default) is the app's signed-in page width
    // (history, assets, repos, teams, shares and dashboard all use it).
    // /admin was the only one at max-w-7xl, 128px wider than every page you
    // reach it from, so the content edge jumped on entry and again on exit.
    <AppPageShell padding="py-8">
      {/* Page header. The health verdict sits here rather than only on the
            Overview tab: an operator who opened /admin?tab=error-logs from a
            link never passes Overview, and this is the one element on screen
            on every tab. It is a link, not a badge, so the fault is one click
            from the summary that explains it. Nothing renders when everything
            is healthy: a green "all clear" on every page is the noise that
            makes a red one easy to miss. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every section here is filtered to what your role can act on.
          </p>
        </div>
        {(worstHealth === "crit" || worstHealth === "warn") &&
          activeTab !== "overview" && (
            <a
              href="/admin?tab=overview"
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  handleTabChange("overview");
                }
              }}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                worstHealth === "crit"
                  ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
                  : "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/15",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  worstHealth === "crit"
                    ? "bg-destructive"
                    : "bg-[hsl(var(--warning))]",
                )}
                aria-hidden="true"
              />
              <span className="tabular-nums">
                {healthProblemCount}{" "}
                {healthProblemCount === 1 ? "check needs" : "checks need"}{" "}
                attention
              </span>
            </a>
          )}
      </div>

      {panelLoading ? (
        <AdminDataSkeleton />
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <aside className="w-full min-w-0 lg:w-52 shrink-0">
            {/* Mobile: single button opens a grouped section drawer,
                  same interaction as the docs mobile nav, instead of the
                  horizontal icon strip this replaces. The button itself
                  shows the active tab's icon and label. */}
            <div className="lg:hidden mb-4">
              <AdminMobileSectionTrigger
                icon={activeTabMeta?.icon ?? Users}
                label={activeTabMeta?.label ?? "Admin Panel"}
                isOpen={mobileNavOpen}
                onToggle={() => setMobileNavOpen((o) => !o)}
                status={
                  worstHealth === "crit"
                    ? "crit"
                    : worstHealth === "warn"
                      ? "warn"
                      : undefined
                }
                statusLabel={`${healthProblemCount} ${healthProblemCount === 1 ? "check needs" : "checks need"} attention`}
              />
            </div>
            <AdminMobileToc
              id="admin-section-nav"
              eyebrow="Navigate to"
              title="Admin Panel"
              items={mobileSectionItems}
              isOpen={mobileNavOpen}
              onClose={() => setMobileNavOpen(false)}
            />

            {/* Desktop: grouped vertical nav, self-start is required for sticky to work in a flex row */}
            {/* The sticky offset has to track both banner heights the way
                components/scanner/header.tsx does, or the nav paints over the
                top of this sidebar. --vr-imp-banner-h matters here more than
                anywhere: impersonation is started from this very panel. */}
            <nav className="hidden lg:flex flex-col gap-5 sticky top-[calc(5rem+var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] self-start transition-[top] duration-300">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 mb-1.5">
                    {group.label}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((tab) => {
                      // Overview carries the aggregate (it is the drill-in for
                      // everything); every other item carries only its own.
                      const tabHealth =
                        tab.key === "overview"
                          ? worstHealth
                          : healthByTab[tab.key];
                      const showDot =
                        tabHealth === "crit" || tabHealth === "warn";
                      return (
                        <a
                          key={tab.key}
                          // Real navigation (ctrl/meta-click opening a new
                          // tab) reads this href directly and never runs the
                          // onClick handler below -- it has to be the actual
                          // ?tab= query param the page reads on load, not a
                          // hash fragment nothing here ever parses.
                          href={`/admin?tab=${tab.key}`}
                          onClick={(e) => {
                            if (!e.ctrlKey && !e.metaKey) {
                              e.preventDefault();
                              handleTabChange(tab.key);
                            }
                          }}
                          // a11y (SC 4.1.2): which section is open was carried
                          // in colour and weight only.
                          aria-current={
                            activeTab === tab.key ? "page" : undefined
                          }
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-lg transition-all",
                            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                            activeTab === tab.key
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                          )}
                        >
                          <tab.icon
                            className="h-4 w-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="flex-1">{tab.label}</span>
                          {/* One dot vocabulary across the whole nav: amber
                              needs attention, red is critical, nothing at all
                              is healthy. The updater used to own a separate
                              blue dot meaning "update available"; that is a
                              health row now (state "warn"), so it renders
                              here like every other signal instead of teaching
                              the operator a second colour. */}
                          {showDot && (
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0",
                                tabHealth === "crit"
                                  ? "bg-destructive"
                                  : "bg-[hsl(var(--warning))]",
                              )}
                              aria-label={
                                tabHealth === "crit"
                                  ? `${tab.label}: critical`
                                  : `${tab.label}: needs attention`
                              }
                            />
                          )}
                        </a>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          {/* Main content */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Operations */}
            {activeTab === "overview" && (
              <HealthOverview
                metrics={health}
                loading={healthLoading}
                refreshing={healthRefreshing}
                loadFailed={healthFailed}
                updateAvailable={updateAvailable}
                onRefresh={() => fetchHealth(false)}
                onNavigate={handleTabChange}
              />
            )}

            {/* Feature sections */}
            {activeTab === "access-rules" && <IPRulesManager />}
            {activeTab === "blocked-data" && <BlockedDataManager />}
            {activeTab === "content" && <ContentManager />}
            {activeTab === "security-alerts" && <SecurityAlertsManager />}
            {activeTab === "settings" && <SystemSettingsManager />}
            {activeTab === "broadcast" && <MassEmailManager />}

            {/* User detail */}
            {selectedUser && activeTab === "users" && (
              <UserDetailPanel
                detail={selectedUser}
                detailLoading={detailLoading}
                actionLoading={actionLoading}
                callerRole={callerRole}
                allBadges={allBadges}
                onBadgesChanged={(awardedIds, revokedIds) => {
                  setSelectedUser((prev) => {
                    if (!prev) return prev;
                    const awardedBadges = allBadges
                      .filter((b) => awardedIds.includes(b.id))
                      .map((b) => ({
                        id: b.id,
                        name: b.name,
                        display_name: b.display_name,
                        description: b.description,
                        icon: b.icon,
                        color: b.color,
                        priority: b.priority,
                        is_limited: b.is_limited,
                        image_url: null,
                        awarded_at: new Date().toISOString(),
                      }));
                    const kept = prev.badges.filter(
                      (b) => !revokedIds.includes(b.id),
                    );
                    return { ...prev, badges: [...kept, ...awardedBadges] };
                  });
                }}
                onClose={() => {
                  setSelectedUser(null);
                  updateUrlWithUser(null, activeTab);
                }}
                onAction={async (userId, action, extra) =>
                  handleAction(userId, action, extra)
                }
              />
            )}

            {/* Users: the growth strip, directory table and mobile list all
                live in components/admin/users/users-tab.tsx (AUDIT-014
                qols-01). It was ~500 lines inlined here while every other
                destination was already its own code-split component. */}
            {activeTab === "users" && !selectedUser && (
              <UsersTab
                stats={stats}
                users={sortedUsers}
                page={page}
                totalPages={totalPages}
                pageSize={usersPageSize}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                searchLoading={searchLoading}
                sort={userSort}
                onToggleSort={toggleUserSort}
                onRefresh={() =>
                  fetchData(page, searchQuery, false, usersPageSize)
                }
                onPageChange={(p) =>
                  fetchData(p, searchQuery, false, usersPageSize)
                }
                onPageSizeChange={(s) => {
                  setUsersPageSize(s);
                  fetchData(1, searchQuery, false, s);
                }}
                onOpenUser={fetchUserDetail}
              />
            )}

            {/* Audit log */}
            {activeTab === "audit" && (
              <AuditLog
                auditLogs={auditLogs}
                auditPaging={auditPaging}
                auditPage={auditPage}
                auditTotalPages={auditTotalPages}
                auditPageSize={auditPageSize}
                setAuditPageSize={setAuditPageSize}
                fetchAudit={fetchAudit}
              />
            )}

            {/* Active Staff */}
            {activeTab === "admins" && (
              <StaffList
                activeAdmins={activeAdmins}
                adminsLoading={adminsLoading}
                fetchActiveAdmins={fetchActiveAdmins}
              />
            )}

            {/* Teams */}
            {activeTab === "teams" && (
              <TeamsList
                teams={teams}
                teamsLoading={teamsLoading}
                teamsSearch={teamsSearch}
                setTeamsSearch={setTeamsSearch}
                fetchTeams={fetchTeams}
                teamsTotalPages={teamsTotalPages}
                teamsPage={teamsPage}
                teamsPageSize={teamsPageSize}
                setTeamsPageSize={setTeamsPageSize}
                handleTeamRename={handleTeamRename}
                handleTeamDelete={handleTeamDelete}
                fetchTeamMembers={fetchTeamMembers}
                teamMembers={teamMembers}
                setTeamMembers={setTeamMembers}
                teamMembersLoading={teamMembersLoading}
                actionLoading={actionLoading}
                callerRole={callerRole}
              />
            )}

            {/* Notifications */}
            {activeTab === "notifications" && <NotificationsManager />}
            {activeTab === "ai-chats" && <AIChatsManager />}
            {activeTab === "support-tickets" && <SupportInbox />}
            {activeTab === "updater" && <UpdaterManager />}
            {activeTab === "backup" && <BackupManager />}
            {activeTab === "queue-status" && <QueueStatusManager />}
            {activeTab === "error-logs" && <ErrorLogsManager />}
            {activeTab === "email-logs" && <EmailLogsManager />}
            {activeTab === "engine-feedback" && <EngineFeedbackManager />}
            {activeTab === "billing-overview" && <BillingOverviewManager />}
          </div>
        </div>
      )}

      {toast && <AdminToast toast={toast} onClose={() => setToast(null)} />}
    </AppPageShell>
  );
}
