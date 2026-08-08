"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Users,
  ShieldCheck,
  ShieldOff,
  Search,
  Shield,
  Globe,
  Settings,
  UsersRound,
  Bell,
  Send,
  RefreshCw,
  History,
  Ban,
  Eye,
  MessageCircle,
  Activity,
  Lock,
  UserX,
  KeyRound,
  Webhook,
  Calendar,
  Zap,
  UserPlus,
  Share2,
} from "lucide-react";
import { IPRulesManager } from "@/components/admin/features/ip-rules-manager";
import { BlockedDataManager } from "@/components/admin/features/blocked-data-manager";
import { SecurityAlertsManager } from "@/components/admin/features/security-alerts-manager";
import { SystemSettingsManager } from "@/components/admin/features/system-settings-manager";
import { MassEmailManager } from "@/components/admin/features/mass-email-manager";
import { AIChatsManager } from "@/components/admin/features/ai-chats-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { cn } from "@/lib/ui/utils";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  API,
  ROUTES,
} from "@/lib/config/constants";
import {
  getAllQueryParams,
  setQueryParam,
  setQueryParams,
} from "@/lib/ui/url-state";
import { NotificationsManager } from "@/components/admin/notifications";
import {
  EmptyState,
  SortableHeader,
  TableScrollArea,
  StatBar,
  AdminMobileToc,
  AdminMobileSectionTrigger,
  type AdminTocItem,
  type SortDirection,
} from "@/components/admin/shared";
import { AdminSkeleton } from "@/components/admin/admin-skeleton";

const VALID_TABS = [
  "users",
  "audit",
  "admins",
  "notifications",
  "teams",
  "access-rules",
  "blocked-data",
  "security-alerts",
  "settings",
  "broadcast",
  "ai-chats",
] as const;

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
import {
  UserAvatar,
  Toast as AdminToast,
  ConfirmDialog,
} from "@/components/admin/shared";
import { UserDetailPanel } from "@/components/admin/users";
import { AuditLog } from "@/components/admin/audit";
import { StaffList } from "@/components/admin/staff";
import { TeamsList } from "@/components/admin/teams";

type ActiveTab =
  | "users"
  | "audit"
  | "admins"
  | "notifications"
  | "teams"
  | "access-rules"
  | "blocked-data"
  | "security-alerts"
  | "settings"
  | "broadcast"
  | "ai-chats";

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    action: () => Promise<void>;
    children?: React.ReactNode;
  } | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
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
  const teamsSearchInitRef = useRef(false);
  const fetchTeamsRef = useRef<
    ((p?: number, search?: string) => Promise<void>) | null
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
    async (p: number, search: string, isInitial: boolean, limit: number) => {
      if (isInitial) setLoading(true);
      else setSearchLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(limit),
        });
        if (search.trim()) params.set("search", search.trim());
        const res = await fetch(`${API.ADMIN}?${params}`);
        if (res.status === 403) {
          setForbidden(true);
          setLoading(false);
          setSearchLoading(false);
          return;
        }
        const data = await res.json();
        setStats(data.stats);
        setUsers(data.users);
        setPage(data.page);
        setTotalPages(data.totalPages);
        if (data.callerRole) setCallerRole(data.callerRole);
      } catch (error) {
        console.error("Failed to fetch admin data", error);
        setForbidden(true);
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
        const data = await res.json();
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
      const data = await res.json();
      setActiveAdmins(data.admins || []);
    } catch (error) {
      console.error("Failed to fetch active admins", error);
    }
    setAdminsLoading(false);
  }, []);

  const fetchTeams = useCallback(
    async (p = 1, search?: string) => {
      setTeamsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), limit: "10" });
        const searchTerm = search !== undefined ? search : teamsSearch;
        if (searchTerm.trim()) params.set("search", searchTerm.trim());
        const res = await fetch(`/api/v3/admin/teams?${params}`);
        const data = await res.json();
        setTeams(data.teams || []);
        setTeamsPage(data.page || 1);
        setTeamsTotalPages(data.totalPages || 1);
      } catch {
        /* ignore */
      }
      setTeamsLoading(false);
    },
    [teamsSearch],
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
        const data = await res.json();
        setSelectedUser(data);
        if (!skipUrlUpdate) updateUrlWithUser(userId, activeTab, false);
      } catch {
        showToast("Failed to load user details.", "error");
      }
      setDetailLoading(false);
    },
    [activeTab, updateUrlWithUser, showToast],
  );

  const fetchAllBadges = useCallback(async () => {
    try {
      const res = await fetch(`${API.ADMIN}?section=badges`);
      if (res.ok) {
        const data = await res.json();
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
      setQueryParam("tab", "users", { replace: true });
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
    handleQueryChange();
    window.addEventListener("popstate", handleQueryChange);
    return () => window.removeEventListener("popstate", handleQueryChange);
  }, [handleQueryChange]);

  useEffect(() => {
    if (activeTab === "audit") fetchAudit();
    if (activeTab === "admins") fetchActiveAdmins();
  }, [activeTab, fetchActiveAdmins, fetchAudit]);

  useEffect(() => {
    fetchData(1, "", true, 10);
    fetchAllBadges();
  }, [fetchData, fetchAllBadges]);

  async function fetchTeamMembers(teamId: number) {
    setTeamMembersLoading(true);
    try {
      const res = await fetch(`/api/v3/admin/teams/${teamId}`);
      const data = await res.json();
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
        const data = await res.json();
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
        setConfirmDialog(null);
        fetchTeams(teamsPage);
      } else {
        const data = await res.json();
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
  ) {
    setActionLoading(`${userId}-${action}`);
    try {
      const res = await fetch(API.ADMIN, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action, ...extra }),
      });
      const data = await res.json();
      if (res.ok) {
        if (action === "reset_password" && data.tempPassword)
          setTempPassword(data.tempPassword);
        const labels: Record<string, string> = {
          set_role: "User role updated.",
          make_admin: "User promoted to admin.",
          remove_admin: "Admin privileges removed.",
          reset_password: "Password has been reset.",
          revoke_sessions: "All sessions revoked.",
          revoke_api_keys: "All API keys revoked.",
          disable: "Account disabled.",
          enable: "Account re-enabled.",
          delete: "User deleted.",
          award_badge: "Badge awarded.",
          revoke_badge: "Badge removed from user.",
          create_badge: "Badge created.",
          delete_badge: "Badge deleted permanently.",
          update_name: "Name updated.",
          update_email: "Email updated.",
          update_plan: "Plan updated.",
          reset_2fa: "Two-factor authentication reset.",
          delete_scans: "All scans deleted.",
          clear_rate_limits: "Rate limits cleared.",
          gift_subscription: "Subscription gifted successfully.",
          revoke_gift: "Gifted subscription revoked.",
          toggle_ai_ban: "AI chat access updated.",
          verify_email: "Email verified.",
          unverify_email: "Email unverified.",
          toggle_beta_access: "Beta access updated.",
          send_notification: "Notification sent.",
          send_email: "Email sent.",
        };
        if (action === "create_badge" || action === "delete_badge") {
          fetchAllBadges();
        }
        showToast(labels[action] || "Action completed.", "success");
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
      } else {
        showToast(data.error || "Action failed.", "error");
      }
    } catch {
      showToast("Action failed.", "error");
    }
    setActionLoading(null);
    setConfirmDialog(null);
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
        const params = new URLSearchParams({ page: "1" });
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

  // Client-side sort of the currently loaded page of users. Does not
  // trigger a refetch; only reorders what's already on screen.
  const sortedUsers = useMemo(() => {
    if (!userSort.column || !userSort.direction) return users;
    const dir = userSort.direction === "asc" ? 1 : -1;
    return [...users].sort((a, b) => {
      if (userSort.column === "name") {
        const an = (a.name || a.email).toLowerCase();
        const bn = (b.name || b.email).toLowerCase();
        return an < bn ? -1 * dir : an > bn ? 1 * dir : 0;
      }
      // "joined"
      return (
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
        dir
      );
    });
  }, [users, userSort]);

  const toggleUserSort = (column: "name" | "joined") => {
    setUserSort((prev) => {
      if (prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      return { column: null, direction: null };
    });
  };

  // Forbidden screen
  if (forbidden) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center flex flex-col items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <ShieldOff className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Access Denied
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                You do not have administrator privileges to access this panel.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
              <a href={ROUTES.DASHBOARD}>Back to Scanner</a>
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (loading) {
    return <AdminSkeleton />;
  }

  const NAV_GROUPS = [
    {
      label: "User Management",
      items: [
        { key: "users" as const, label: "Users", icon: Users },
        { key: "teams" as const, label: "Teams", icon: UsersRound },
        { key: "admins" as const, label: "Active Staff", icon: Shield },
      ],
    },
    {
      label: "Security",
      items: [
        { key: "access-rules" as const, label: "Access Rules", icon: Globe },
        { key: "blocked-data" as const, label: "Blocked Data", icon: Ban },
        { key: "security-alerts" as const, label: "Alerts", icon: ShieldCheck },
        { key: "audit" as const, label: "Audit Log", icon: History },
      ],
    },
    {
      label: "Communications",
      items: [
        { key: "broadcast" as const, label: "Broadcast", icon: Send },
        { key: "notifications" as const, label: "Notifications", icon: Bell },
        { key: "ai-chats" as const, label: "AI Chats", icon: MessageCircle },
      ],
    },
    {
      label: "System",
      items: [{ key: "settings" as const, label: "Settings", icon: Settings }],
    },
  ];

  const ALL_ADMIN_TABS: Array<{
    key: string;
    label: string;
    icon: LucideIcon;
  }> = NAV_GROUPS.reduce<
    Array<{ key: string; label: string; icon: LucideIcon }>
  >((acc, g) => [...acc, ...g.items], []);

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey as typeof activeTab);
    if (tabKey === "audit") fetchAudit();
    if (tabKey === "admins") fetchActiveAdmins();
    if (tabKey === "teams") fetchTeams();
    setSelectedUser(null);
    updateUrlWithUser(null, tabKey, false);
  };

  const activeTabMeta = ALL_ADMIN_TABS.find((t) => t.key === activeTab);

  // Site-wide section list for the mobile drawer, grouped the same way
  // NAV_GROUPS groups the desktop sidebar.
  const mobileSectionItems: AdminTocItem[] = NAV_GROUPS.reduce<AdminTocItem[]>(
    (acc, group) => [
      ...acc,
      ...group.items.map((tab) => ({
        id: tab.key,
        label: tab.label,
        group: group.label,
        active: activeTab === tab.key,
        onSelect: () => handleTabChange(tab.key),
      })),
    ],
    [],
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage users, monitor activity, and control system settings.
          </p>
        </div>

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
            <nav className="hidden lg:flex flex-col gap-5 sticky top-20 self-start">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 mb-1.5">
                    {group.label}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((tab) => (
                      <a
                        key={tab.key}
                        href={`/admin#${tab.key}`}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            handleTabChange(tab.key);
                          }
                        }}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-lg transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          activeTab === tab.key
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                        )}
                      >
                        <tab.icon
                          className="h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span>{tab.label}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          {/* Main content */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Stats row, Users tab only. A live count strip, not a grid of
                  decorative cards. Filtering the table by these segments
                  (e.g. Disabled) needs a status filter the admin API does
                  not expose yet (it only takes page/limit/search), so these
                  stay informational until that lands. */}
            {activeTab === "users" && stats && !selectedUser && (
              <div className="space-y-3">
                <StatBar
                  items={[
                    {
                      label: "Total Users",
                      value: Number(stats.total_users),
                      icon: Users,
                      tone: "primary",
                    },
                    {
                      label: "Total Scans",
                      value: Number(stats.total_scans),
                      icon: Activity,
                      tone: "purple",
                    },
                    {
                      label: "Scans (24h)",
                      value: Number(stats.scans_24h),
                      icon: Zap,
                      tone: "orange",
                    },
                    {
                      label: "2FA Enabled",
                      value: Number(stats.users_with_2fa),
                      icon: Lock,
                      tone: "success",
                    },
                    {
                      label: "Disabled",
                      value: Number(stats.disabled_users),
                      icon: UserX,
                      tone: "destructive",
                    },
                  ]}
                />
                <StatBar
                  items={[
                    {
                      label: "New Users (7d)",
                      value: Number(stats.new_users_7d),
                      icon: UserPlus,
                      tone: "success",
                    },
                    {
                      label: "Active API Keys",
                      value: Number(stats.active_api_keys),
                      icon: KeyRound,
                      tone: "purple",
                    },
                    {
                      label: "Active Webhooks",
                      value: Number(stats.active_webhooks),
                      icon: Webhook,
                      tone: "orange",
                    },
                    {
                      label: "Schedules",
                      value: Number(stats.active_schedules),
                      icon: Calendar,
                      tone: "primary",
                    },
                    {
                      label: "Shared Scans",
                      value: Number(stats.shared_scans),
                      icon: Share2,
                      tone: "muted",
                    },
                  ]}
                />
              </div>
            )}

            {/* Feature sections */}
            {activeTab === "access-rules" && <IPRulesManager />}
            {activeTab === "blocked-data" && <BlockedDataManager />}
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
                  setTempPassword(null);
                  updateUrlWithUser(null, activeTab);
                }}
                onAction={async (userId, action, extra) => {
                  if (extra && Object.keys(extra).length > 0)
                    return handleAction(userId, action, extra);
                  if (
                    [
                      "set_role",
                      "award_badge",
                      "revoke_badge",
                      "create_badge",
                      "delete_badge",
                      "update_name",
                      "update_email",
                      "update_plan",
                      "enable",
                      "clear_rate_limits",
                      "gift_subscription",
                      "revoke_gift",
                      "add_note",
                      "edit_note",
                      "delete_note",
                      "verify_email",
                      "unverify_email",
                      "toggle_beta_access",
                      "send_notification",
                      "send_email",
                      "toggle_ai_ban",
                      "clear_rate_limits",
                      "clear_avatar",
                      "force_logout_all",
                      "delete_webhooks",
                      "delete_schedules",
                    ].includes(action)
                  ) {
                    return handleAction(userId, action, extra);
                  }
                  const confirmActions = [
                    "delete",
                    "disable",
                    "reset_password",
                    "revoke_sessions",
                    "revoke_api_keys",
                    "reset_2fa",
                    "delete_scans",
                  ];
                  if (confirmActions.includes(action)) {
                    const messages: Record<
                      string,
                      {
                        title: string;
                        desc: string;
                        label: string;
                        danger?: boolean;
                      }
                    > = {
                      delete: {
                        title: "Delete User",
                        desc: `This will permanently delete ${selectedUser.user.email} and all their data. This cannot be undone.`,
                        label: "Delete User",
                        danger: true,
                      },
                      disable: {
                        title: "Disable Account",
                        desc: `This will suspend ${selectedUser.user.email}'s account and log them out of all sessions. They will not be able to log in until re-enabled.`,
                        label: "Disable Account",
                        danger: true,
                      },
                      reset_password: {
                        title: "Reset Password",
                        desc: `This will generate a temporary password for ${selectedUser.user.email}. All sessions will be invalidated. Share the temporary password securely.`,
                        label: "Reset Password",
                      },
                      revoke_sessions: {
                        title: "Revoke All Sessions",
                        desc: `This will force-logout ${selectedUser.user.email} from all devices and browsers.`,
                        label: "Revoke Sessions",
                      },
                      revoke_api_keys: {
                        title: "Revoke All API Keys",
                        desc: `This will immediately revoke all active API keys for ${selectedUser.user.email}.`,
                        label: "Revoke Keys",
                      },
                      reset_2fa: {
                        title: "Reset Two-Factor Authentication",
                        desc: `This will remove 2FA from ${selectedUser.user.email}'s account. They will need to set it up again.`,
                        label: "Reset 2FA",
                        danger: true,
                      },
                      delete_scans: {
                        title: "Delete All Scans",
                        desc: `This will permanently delete all scan history for ${selectedUser.user.email}. This cannot be undone.`,
                        label: "Delete Scans",
                        danger: true,
                      },
                    };
                    const m = messages[action];
                    setConfirmDialog({
                      title: m.title,
                      description: m.desc,
                      confirmLabel: m.label,
                      danger: m.danger ?? false,
                      action: () => handleAction(userId, action),
                    });
                  } else {
                    return handleAction(userId, action);
                  }
                }}
                tempPassword={tempPassword}
                onClearTempPassword={() => setTempPassword(null)}
              />
            )}

            {/* Users table */}
            {activeTab === "users" && !selectedUser && (
              <Card className="border-border/50 bg-card/50 overflow-hidden">
                <CardHeader className="pb-4 pt-5 px-5">
                  <div className="flex flex-col gap-4">
                    {/* Title row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                          <Users
                            className="h-4 w-4 text-primary"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold truncate">
                            User Directory
                          </CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            Manage and view all registered users
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className="text-xs font-medium h-6 px-2.5 shrink-0"
                      >
                        {stats ? Number(stats.total_users).toLocaleString() : 0}{" "}
                        users
                      </Badge>
                    </div>
                    {/* Search and actions row */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="relative flex-1">
                        <Search
                          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                          aria-hidden="true"
                        />
                        <Input
                          placeholder="Search by name or email..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          aria-label="Search users by name or email"
                          className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 px-3 gap-2 border-border/40 shrink-0"
                        aria-label="Refresh users"
                        onClick={() =>
                          fetchData(page, searchQuery, false, usersPageSize)
                        }
                      >
                        <RefreshCw
                          className={cn(
                            "h-4 w-4",
                            searchLoading && "animate-spin",
                          )}
                          aria-hidden="true"
                        />
                        <span className="hidden sm:inline">Refresh</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {/* Desktop table */}
                  <div className="hidden md:block">
                    {sortedUsers.length === 0 ? (
                      <EmptyState
                        icon={Search}
                        title="No users found"
                        description={
                          searchQuery
                            ? `No results for "${searchQuery}". Try a different search term.`
                            : "No users have registered yet."
                        }
                      />
                    ) : (
                      <TableScrollArea maxHeight="65vh">
                        <Table>
                          <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/90">
                            <TableRow className="border-y border-border/50 hover:bg-transparent">
                              <TableHead className="px-5 h-10">
                                <SortableHeader
                                  label="User"
                                  active={userSort.column === "name"}
                                  direction={
                                    userSort.column === "name"
                                      ? userSort.direction
                                      : null
                                  }
                                  onClick={() => toggleUserSort("name")}
                                />
                              </TableHead>
                              <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Activity
                              </TableHead>
                              <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Status
                              </TableHead>
                              <TableHead className="px-4 h-10">
                                <SortableHeader
                                  label="Joined"
                                  active={userSort.column === "joined"}
                                  direction={
                                    userSort.column === "joined"
                                      ? userSort.direction
                                      : null
                                  }
                                  onClick={() => toggleUserSort("joined")}
                                />
                              </TableHead>
                              <TableHead className="px-5 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody
                            className={cn(
                              "transition-opacity duration-200",
                              searchLoading && "opacity-40 pointer-events-none",
                            )}
                          >
                            {sortedUsers.map((u) => (
                              <TableRow
                                key={u.id}
                                className="border-border/40 cursor-pointer group"
                                onClick={() => fetchUserDetail(u.id)}
                              >
                                <TableCell className="px-5 py-4">
                                  <div className="flex items-center gap-3">
                                    <UserAvatar
                                      name={u.name}
                                      email={u.email}
                                      avatarUrl={u.avatar_url}
                                    />
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium truncate">
                                        {u.name || "Unnamed"}
                                      </p>
                                      <p className="text-xs text-muted-foreground truncate font-mono">
                                        {u.email}
                                      </p>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="px-4 py-4">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-medium">
                                      {u.scan_count}{" "}
                                      <span className="text-muted-foreground font-normal">
                                        scans
                                      </span>
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {u.api_key_count} API keys
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="px-4 py-4">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {u.disabled_at ? (
                                      <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-2 py-0.5 font-medium">
                                        Disabled
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20 text-[10px] px-2 py-0.5 font-medium">
                                        Active
                                      </Badge>
                                    )}
                                    {u.role &&
                                      u.role !== STAFF_ROLES.USER &&
                                      ROLE_BADGE_STYLES[u.role] && (
                                        <Badge
                                          className={cn(
                                            ROLE_BADGE_STYLES[u.role],
                                            "text-[10px] px-2 py-0.5 font-medium",
                                          )}
                                        >
                                          {STAFF_ROLE_LABELS[u.role] || u.role}
                                        </Badge>
                                      )}
                                    {(() => {
                                      const effectivePlan =
                                        u.gifted_plan || u.plan;
                                      if (
                                        effectivePlan &&
                                        effectivePlan !== "free"
                                      ) {
                                        const planLabel =
                                          effectivePlan
                                            .replace("_supporter", "")
                                            .charAt(0)
                                            .toUpperCase() +
                                          effectivePlan
                                            .replace("_supporter", "")
                                            .slice(1);
                                        return (
                                          <Badge
                                            className={cn(
                                              "text-[10px] px-2 py-0.5 font-medium",
                                              u.gifted_plan
                                                ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                                : "bg-primary/10 text-primary border-primary/20",
                                            )}
                                          >
                                            {planLabel}
                                            {u.gifted_plan ? " (Gift)" : ""}
                                          </Badge>
                                        );
                                      }
                                      return null;
                                    })()}
                                    {u.totp_enabled && (
                                      <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-2 py-0.5 font-medium">
                                        2FA
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
                                  {new Date(u.created_at).toLocaleDateString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    },
                                  )}
                                </TableCell>
                                <TableCell className="px-5 py-4">
                                  <div className="flex items-center justify-end">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                                      asChild
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <a
                                        href={`/admin#users/user-${u.id}`}
                                        aria-label={`View ${u.name || u.email}`}
                                        onClick={(e) => {
                                          if (!e.ctrlKey && !e.metaKey) {
                                            e.preventDefault();
                                            fetchUserDetail(u.id);
                                          }
                                        }}
                                      >
                                        <Eye
                                          className="h-3.5 w-3.5"
                                          aria-hidden="true"
                                        />
                                        <span className="text-xs">View</span>
                                      </a>
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableScrollArea>
                    )}
                  </div>

                  {/* Mobile list */}
                  <div
                    className={cn(
                      "md:hidden flex flex-col transition-opacity duration-200",
                      searchLoading && "opacity-40 pointer-events-none",
                    )}
                  >
                    {sortedUsers.length === 0 && (
                      <EmptyState
                        icon={Search}
                        title="No users found"
                        description={
                          searchQuery
                            ? `No results for "${searchQuery}".`
                            : "No users have registered yet."
                        }
                      />
                    )}
                    {sortedUsers.map((u) => (
                      <a
                        key={u.id}
                        href={`/admin#users/user-${u.id}`}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            fetchUserDetail(u.id);
                          }
                        }}
                        className="flex items-center gap-3 px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      >
                        <UserAvatar
                          name={u.name}
                          email={u.email}
                          size="sm"
                          avatarUrl={u.avatar_url}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-medium truncate">
                              {u.name || "Unnamed"}
                            </p>
                            {u.disabled_at ? (
                              <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5 shrink-0">
                                Disabled
                              </Badge>
                            ) : u.role &&
                              u.role !== STAFF_ROLES.USER &&
                              ROLE_BADGE_STYLES[u.role] ? (
                              <Badge
                                className={cn(
                                  ROLE_BADGE_STYLES[u.role],
                                  "text-[10px] px-1.5 shrink-0",
                                )}
                              >
                                {STAFF_ROLE_LABELS[u.role]}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground truncate font-mono">
                            {u.email}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                            <span>{u.scan_count} scans</span>
                            <span className="text-border">|</span>
                            <span>
                              {new Date(u.created_at).toLocaleDateString(
                                "en-US",
                                { month: "short", day: "numeric" },
                              )}
                            </span>
                            {(() => {
                              const effectivePlan = u.gifted_plan || u.plan;
                              if (effectivePlan && effectivePlan !== "free") {
                                const label =
                                  effectivePlan
                                    .replace("_supporter", "")
                                    .charAt(0)
                                    .toUpperCase() +
                                  effectivePlan
                                    .replace("_supporter", "")
                                    .slice(1);
                                return (
                                  <>
                                    <span className="text-border">|</span>
                                    <Badge
                                      className={cn(
                                        "text-[10px] px-1.5 py-0",
                                        u.gifted_plan
                                          ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                          : "bg-primary/10 text-primary border-primary/20",
                                      )}
                                    >
                                      {label}
                                    </Badge>
                                  </>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </div>
                        <Eye
                          className="h-4 w-4 text-muted-foreground/50 shrink-0"
                          aria-hidden="true"
                        />
                      </a>
                    ))}
                  </div>

                  {/* Pagination */}
                  {sortedUsers.length > 0 && (
                    <div className="px-5 py-4 border-t border-border/40 bg-muted/20">
                      <PaginationControl
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={(p) =>
                          fetchData(p, searchQuery, false, usersPageSize)
                        }
                        pageSize={usersPageSize}
                        onPageSizeChange={(s) => {
                          setUsersPageSize(s);
                          fetchData(1, searchQuery, false, s);
                        }}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
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
          </div>
        </div>
      </main>
      <Footer />

      {confirmDialog && (
        <ConfirmDialog
          open={true}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.action}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {toast && <AdminToast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
