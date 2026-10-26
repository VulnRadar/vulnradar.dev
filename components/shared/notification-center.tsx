"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  X,
  ArrowRight,
  AlertTriangle,
  Bell,
  ExternalLink,
  Info,
  CheckCircle2,
  UserPlus,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { focus } from "@/lib/ui/animations";
import { cn, safeHref } from "@/lib/ui/utils";
import { useAuth } from "@/components/providers/auth-provider";
import {
  STAFF_ROLES,
  APP_VERSION,
  APP_NAME,
  VERSION_COOKIE_NAME,
  ROUTES,
  API,
} from "@/lib/config/client-constants";
import { Sparkles } from "lucide-react";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/use-toast";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";
import { useOnline } from "@/lib/hooks/use-online";
import { matchesPathPattern } from "@/lib/notifications/match-path";
import { fetchActiveNotifications } from "@/components/shared/active-notifications";
import { focusAfterRemoval } from "@/components/shared/notification-focus";

const STAFF_ROLE_VALUES = Object.values(STAFF_ROLES);

// ─── Cookie Helpers ──────────────────────────────────────────────

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const cookies = document.cookie.split("; ");
  return cookies.find((c) => c.startsWith(`${name}=`))?.split("=")[1];
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

// ─── Types ───────────────────────────────────────────────────────

interface ApiNotification {
  id: number;
  cookie_id: string;
  title: string;
  message: string;
  type: "bell" | "banner" | "modal" | "toast";
  variant: "info" | "success" | "warning" | "error";
  audience: string;
  path_pattern: string | null;
  is_dismissible: boolean;
  dismiss_duration_hours: number | null;
  action_label: string | null;
  action_url: string | null;
  action_external: boolean;
  action_label_2: string | null;
  action_url_2: string | null;
  action_external_2: boolean;
  priority: number;
}

// Per-user in-app notification (the general inbox, e.g. team invites).
// Distinct from ApiNotification above, which is the staff-authored
// admin_notifications broadcast.
interface UserNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  action_label: string | null;
  action_url: string | null;
  related_type: string | null;
  related_id: number | null;
  created_at: string;
}

// ─── Variant Styles ──────────────────────────────────────────────

const VARIANT_CONFIG: Record<
  string,
  {
    icon: React.ReactNode;
    bg: string;
    border: string;
    text: string;
  }
> = {
  info: {
    icon: <Info className="h-4 w-4" aria-hidden="true" />,
    bg: "bg-primary/10",
    border: "border-primary/30",
    text: "text-primary",
  },
  success: {
    icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
    bg: "bg-[hsl(var(--success))]/10",
    border: "border-[hsl(var(--success))]/30",
    text: "text-[hsl(var(--success))]",
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
    bg: "bg-[hsl(var(--warning))]/10",
    border: "border-[hsl(var(--warning))]/30",
    text: "text-[hsl(var(--warning))]",
  },
  error: {
    icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
    bg: "bg-destructive/10",
    border: "border-destructive/30",
    text: "text-destructive",
  },
};

// ─── Row controls ────────────────────────────────────────────────

// A row's text action ("View", "Accept invite", "View Changelog"). These were
// bare text-xs elements, one 12px line and about 16px tall, under the 24x24
// floor for a standalone control. The padding sits on the control and a
// matching negative margin takes it back out, so the row's rhythm stays where
// it was and only the target grows.
const ROW_ACTION = cn(
  "-my-1.5 inline-flex items-center gap-1 rounded-sm py-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80",
  focus.ring,
);

// The invite's Accept is the one thing this panel exists to offer, and it is
// a thumb target on a phone: 44px there, back to the row action size from sm.
const ROW_ACTION_PRIMARY = cn(
  ROW_ACTION,
  "-my-3 min-h-11 py-3 disabled:opacity-50 sm:-my-1.5 sm:min-h-0 sm:py-1.5",
);

// The single dismiss control every row carries. The text "Dismiss" buttons
// that used to sit beside it did the same thing, which gave a screen-reader
// user two controls with the same name per row. It is an icon button, so
// rounded-full by the radius ladder, 44px on a phone and 24px from sm up.
const ROW_DISMISS = cn(
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 sm:h-6 sm:w-6",
  focus.ring,
);

// ─── Notification Bell (header dropdown) ─────────────────────────

export function NotificationBell() {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { me } = useAuth();
  const clientConfig = useClientConfig();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [userNotifications, setUserNotifications] = useState<
    UserNotification[]
  >([]);
  const [actingOnId, setActingOnId] = useState<number | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  // A failed fetch used to console.error and nothing else, which left the
  // list empty and fell through to the "All caught up!" branch: a pending team
  // invite that could not load read as an empty inbox, on an item with an
  // expiry window. Tracked separately so the panel can say it does not know.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const online = useOnline();
  const [showVersionNotif, setShowVersionNotif] = useState(false);
  // Where focus goes after a dismissal removes the row it was on
  // (notification-focus.ts). The pending entry is written by the dismiss
  // click, which is the only moment the row's position is still known, and
  // read by the effect below once the row has actually left the list.
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocusRef = useRef<{ key: string; index: number } | null>(null);

  const isStaff =
    me?.role && (STAFF_ROLE_VALUES as readonly string[]).includes(me.role);
  // Read out once rather than as `me?.userId` inside the callbacks below: the
  // React Compiler infers the whole `me` object as the dependency when the
  // property access happens inside, which does not match the declared deps and
  // makes it skip optimizing this component entirely.
  const userId = me?.userId;

  // Check if there's a new version (cookie-based)
  useEffect(() => {
    const lastSeenVersion = getCookie(VERSION_COOKIE_NAME);
    if (lastSeenVersion !== APP_VERSION) {
      // New version detected - show notification
      // oxlint-disable-next-line react/set-state-in-effect -- reads a cookie (unavailable during SSR) to seed initial value
      setShowVersionNotif(true);
    }
  }, []);

  // Initialize dismissed IDs from cookies on mount
  useEffect(() => {
    const dismissed = getCookie("vr_notif_dismissed");
    if (dismissed) {
      try {
        const parsed = JSON.parse(decodeURIComponent(dismissed));
        if (Array.isArray(parsed)) {
          // oxlint-disable-next-line react/set-state-in-effect -- reads a cookie (unavailable during SSR) to seed initial value
          setDismissedIds(new Set(parsed.map(String)));
        }
      } catch {
        // Invalid cookie, ignore
      }
    }
  }, []);

  // Shared with the site-notification banner, which is mounted in the same
  // root layout and used to issue a byte-identical second request for this
  // payload on every page view. `force` on the poll ticks so a scheduled
  // refresh is still a real refresh; only the mount-time pair is collapsed.
  const fetchNotifications = useCallback(
    async (force = false) => {
      try {
        const data = await fetchActiveNotifications<ApiNotification>(
          !!userId,
          !!isStaff,
          force,
        );
        // Only show "bell" type notifications in the bell dropdown. Page
        // filtering happens below, at render time, so it stays current as
        // the user navigates without needing a refetch per route change.
        setNotifications(
          data.filter((n: ApiNotification) => n.type === "bell"),
        );
        setLoadError(false);
      } catch (err) {
        console.error("Failed to fetch notifications:", err);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [userId, isStaff],
  );

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetch-on-mount: setState runs only in fetchNotifications' async continuation
    void fetchNotifications();
  }, [fetchNotifications, reloadKey]);

  // Guards a logout (or account switch) landing mid-flight: the reset branch
  // below bumps the ticket, so a response for the previous identity can no
  // longer repopulate the panel after it has been cleared. This is what the
  // old effect's `cancelled` flag did before the poll moved out of it.
  const userNotifReqRef = useRef(0);

  // Fetch the current user's own notifications (e.g. team invites). Only
  // logged-in users have anything to fetch here.
  const fetchUserNotifications = useCallback(async () => {
    if (!userId) return;
    const reqId = ++userNotifReqRef.current;
    try {
      const data = await apiGet<{ notifications: UserNotification[] }>(
        API.NOTIFICATIONS,
      );
      if (reqId !== userNotifReqRef.current) return;
      setUserNotifications(data.notifications);
      setLoadError(false);
    } catch (err) {
      console.error("Failed to fetch user notifications:", err);
      // Team invites arrive on this endpoint, so a failure here is the one
      // that most needs saying out loud rather than showing an empty panel.
      if (reqId === userNotifReqRef.current) setLoadError(true);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      userNotifReqRef.current++;
      // oxlint-disable-next-line react/set-state-in-effect -- resets userNotifications when me.userId changes to logged-out, gated on the dependency array so it only fires on an actual identity change, not every render
      setUserNotifications([]);
      return;
    }
    void fetchUserNotifications();
  }, [userId, fetchUserNotifications, reloadKey]);

  // Both of these were bare setInterval calls, so a backgrounded tab kept
  // issuing two authenticated, database-backed requests every five minutes
  // forever. Five minutes is already slower than the browser's own hidden-tab
  // timer throttle, so nothing was slowing them down. They now stop while the
  // tab is hidden and refresh once on the way back in, which is also the only
  // moment the result can actually be seen.
  useVisibleInterval(
    () => void fetchNotifications(true),
    clientConfig.notificationPollIntervalMs,
  );
  useVisibleInterval(
    () => void fetchUserNotifications(),
    userId ? clientConfig.notificationPollIntervalMs : null,
  );

  // Accept a team invite directly from the bell. Uses inviteId, not the
  // emailed link's plaintext token: the token is never stored anywhere
  // after the invite is created, so a logged-in user acting from the
  // bell goes through the id-based path in accept-invite instead. That
  // route still requires the invitee's email to match the invite before
  // accepting, so a notification only ever lets its intended recipient
  // act on it.
  //
  // A failure used to reach only the console: the button came back and the
  // card stayed, which looks the same as "still working". Both actions now
  // say so, as app/teams/page.tsx already does for the same invite.
  const acceptTeamInvite = useCallback(
    async (n: UserNotification) => {
      if (!n.related_id) return;
      setActingOnId(n.id);
      try {
        await apiPost(API.TEAMS_ACCEPT_INVITE, { inviteId: n.related_id });
        setUserNotifications((prev) => prev.filter((x) => x.id !== n.id));
        setOpen(false);
        router.push(ROUTES.TEAMS);
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Could not join the team",
          description:
            err instanceof ApiError && err.message
              ? err.message
              : "The invite could not be accepted. Try again, or open it from Teams.",
        });
      } finally {
        setActingOnId(null);
      }
    },
    [router, toast],
  );

  // Dismiss a user notification without acting on it (e.g. declining a
  // team invite just means walking away from it, same as the "Decline"
  // link on the emailed invite page).
  const dismissUserNotification = useCallback(
    async (n: UserNotification) => {
      setActingOnId(n.id);
      try {
        await apiPatch(API.NOTIFICATIONS, { id: n.id });
        setUserNotifications((prev) => prev.filter((x) => x.id !== n.id));
      } catch {
        // The row is staying, so there is nothing for focus to move on from.
        pendingFocusRef.current = null;
        toast({
          variant: "destructive",
          title: "Could not dismiss the notification",
          description: "Try again in a moment.",
        });
      } finally {
        setActingOnId(null);
      }
    },
    [toast],
  );

  // Mark component as hydrated after client mount
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the canonical client-hydration-detection pattern: whether hydration has occurred isn't knowable during render itself
    setHydrated(true);
  }, []);

  // Escape, outside clicks, focus return and closing on scroll all come from
  // the shared Popover (components/ui/popover.tsx) rather than from listeners
  // this component installs itself. That also settles a bug the hand-rolled
  // version could not: two panels open at once. A Radix layer dismisses on an
  // interaction outside it, so opening the language menu closes this, and
  // opening this closes that.

  // Dismiss using unique cookie_id - each notification has its own cookie
  const dismissNotification = useCallback(
    (cookieId: string, durationHours: number | null) => {
      const maxAge = durationHours
        ? durationHours * 60 * 60
        : clientConfig.notificationDefaultDismissMaxAgeSeconds;
      setCookie(`dismissed_${cookieId}`, "1", maxAge);
      setDismissedIds((prev) => new Set([...prev, cookieId]));
    },
    [clientConfig.notificationDefaultDismissMaxAgeSeconds],
  );

  const dismissVersionNotif = useCallback(() => {
    setCookie(
      VERSION_COOKIE_NAME,
      APP_VERSION,
      clientConfig.versionCookieMaxAgeSeconds,
    );
    setShowVersionNotif(false);
  }, [clientConfig.versionCookieMaxAgeSeconds]);

  // Called from a row's dismiss control, before the row goes: this is the last
  // moment its position in the list can be read.
  const rememberRow = useCallback((from: HTMLElement) => {
    const row = from.closest<HTMLElement>("[data-notif-row]");
    const panel = panelRef.current;
    if (!row || !panel) return;
    const rows = Array.from(
      panel.querySelectorAll<HTMLElement>("[data-notif-row]"),
    );
    pendingFocusRef.current = {
      key: row.dataset.notifRow ?? "",
      index: rows.indexOf(row),
    };
  }, []);

  // Runs after any change to what the list holds, and acts only once the
  // remembered row is really gone: a dismissal that is still in flight, or a
  // poll that re-rendered the list first, leaves it standing and the entry
  // waiting.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const panel = panelRef.current;
    if (!open || !panel) {
      pendingFocusRef.current = null;
      return;
    }
    const rows = Array.from(
      panel.querySelectorAll<HTMLElement>("[data-notif-row]"),
    );
    if (rows.some((row) => row.dataset.notifRow === pending.key)) return;
    pendingFocusRef.current = null;
    focusAfterRemoval(rows, pending.index, headingRef.current);
  }, [userNotifications, dismissedIds, showVersionNotif, open]);

  // Filter out dismissed notifications (check both Set and cookie) and
  // any whose page filter doesn't match the current route.
  const visibleNotifications = notifications.filter((n) => {
    if (!matchesPathPattern(pathname, n.path_pattern)) return false;
    if (dismissedIds.has(n.cookie_id)) return false;
    // Also check cookie directly for SSR/hydration
    if (
      typeof document !== "undefined" &&
      getCookie(`dismissed_${n.cookie_id}`) === "1"
    )
      return false;
    return true;
  });
  const count =
    visibleNotifications.length +
    userNotifications.length +
    (showVersionNotif ? 1 : 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            hydrated
              ? `Notifications${count > 0 ? ` (${count} unread)` : ""}`
              : "Notifications"
          }
          // The header's icon buttons are one shape: a circle, which is what
          // the radius ladder gives an icon button, at the 44px touch target
          // below sm. The bell was a rounded square at 32px beside a round
          // language button, which read as two different kinds of control.
          className={cn(
            "relative inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9",
            "data-[state=open]:bg-muted data-[state=open]:text-foreground",
            focus.ring,
          )}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {hydrated && count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        // The panel is a list, not prose: it brings its own padding, and the
        // width is the one the rows were built for.
        className="w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden p-0"
      >
        <div ref={panelRef} className="overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-2.5">
            {/* tabIndex -1 so it can take focus when the last row is
                dismissed and there is no row left to hand it to. */}
            <h2
              ref={headingRef}
              tabIndex={-1}
              className={cn(
                "rounded-sm text-base font-semibold tracking-tight text-foreground",
                focus.ring,
              )}
            >
              Notifications
            </h2>
            {count > 0 && !loading && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary">
                {count}
              </span>
            )}
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                <Bell
                  className="h-4 w-4 animate-pulse text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
              <p className="text-xs text-muted-foreground">Loading...</p>
            </div>
          ) : loadError && count === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                <Bell
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
              {/* A dropped connection and a server rejection are different
                  facts and used to read identically here. useOnline() is the
                  one signal that can tell them apart, so the panel says which
                  one happened rather than guessing. */}
              <p className="text-sm font-medium text-foreground">
                {online
                  ? "Couldn't load notifications"
                  : "You are offline, so this could not be checked"}
              </p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className={cn(
                  "-my-1.5 rounded-sm py-1.5 text-xs text-primary hover:underline",
                  focus.ring,
                )}
              >
                Try again
              </button>
            </div>
          ) : count === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                <Bell
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
              <p className="text-sm font-medium text-foreground">
                Nothing waiting
              </p>
              <p className="max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
                Invites, scan alerts and staff notices land here.
              </p>
            </div>
          ) : (
            <div className="max-h-96 divide-y divide-border/40 overflow-y-auto">
              {/* Per-user notifications (e.g. team invites) */}
              {userNotifications.map((n) => {
                const isTeamInvite = n.type === "team_invite";
                const hasAction = isTeamInvite || !!n.action_url;
                const busy = actingOnId === n.id;
                return (
                  <div
                    key={`user-${n.id}`}
                    data-notif-row={`user-${n.id}`}
                    className="px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 p-2 rounded-lg bg-primary/10 border border-primary/30 text-primary">
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground mb-0.5">
                          {n.title}
                        </p>
                        <p
                          className={cn(
                            "text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap",
                            hasAction && "mb-2",
                          )}
                        >
                          {n.message}
                        </p>
                        {hasAction && (
                          <div className="flex items-center gap-3">
                            {isTeamInvite ? (
                              <button
                                onClick={() => acceptTeamInvite(n)}
                                disabled={busy}
                                className={ROW_ACTION_PRIMARY}
                              >
                                {busy ? "Joining..." : "Accept invite"}
                              </button>
                            ) : (
                              n.action_url && (
                                <a
                                  href={safeHref(n.action_url)}
                                  onClick={() => setOpen(false)}
                                  className={ROW_ACTION}
                                >
                                  {n.action_label || "View"}
                                  <ArrowRight
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                </a>
                              )
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          rememberRow(e.currentTarget);
                          void dismissUserNotification(n);
                        }}
                        disabled={busy}
                        data-notif-dismiss=""
                        className={ROW_DISMISS}
                        aria-label={`Dismiss ${n.title}`}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Version notification */}
              {showVersionNotif && (
                <div
                  data-notif-row="version"
                  className="px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 p-2 rounded-lg bg-primary/10 border border-primary/30 text-primary">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground mb-0.5">
                        {APP_NAME} v{APP_VERSION} Released
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                        New features, improvements, and bug fixes are available.
                      </p>
                      <div className="flex items-center gap-2">
                        <a
                          href="/changelog"
                          onClick={() => {
                            dismissVersionNotif();
                            setOpen(false);
                          }}
                          className={ROW_ACTION}
                        >
                          View Changelog
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        rememberRow(e.currentTarget);
                        dismissVersionNotif();
                      }}
                      data-notif-dismiss=""
                      className={ROW_DISMISS}
                      aria-label="Dismiss version notification"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}

              {/* API-driven notifications */}
              {visibleNotifications.map((n) => {
                const config = VARIANT_CONFIG[n.variant] || VARIANT_CONFIG.info;
                const hasAction = !!n.action_url || !!n.action_url_2;
                return (
                  <div
                    key={n.id}
                    data-notif-row={`api-${n.id}`}
                    className="px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "shrink-0 p-2 rounded-lg border",
                          config.bg,
                          config.border,
                          config.text,
                        )}
                      >
                        {config.icon}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground mb-0.5">
                          {n.title}
                        </p>
                        <p
                          className={cn(
                            "text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap",
                            hasAction && "mb-2",
                          )}
                        >
                          {n.message}
                        </p>

                        {hasAction && (
                          <div className="flex items-center gap-3">
                            {n.action_url && (
                              <a
                                href={safeHref(n.action_url)}
                                target={n.action_external ? "_blank" : "_self"}
                                rel={
                                  n.action_external
                                    ? "noopener noreferrer"
                                    : undefined
                                }
                                onClick={() => {
                                  if (n.is_dismissible)
                                    dismissNotification(
                                      n.cookie_id,
                                      n.dismiss_duration_hours,
                                    );
                                  setOpen(false);
                                }}
                                className={ROW_ACTION}
                              >
                                {n.action_label || "View"}
                                {n.action_external ? (
                                  <ExternalLink
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <ArrowRight
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                )}
                              </a>
                            )}
                            {n.action_url_2 && (
                              <a
                                href={safeHref(n.action_url_2)}
                                target={
                                  n.action_external_2 ? "_blank" : "_self"
                                }
                                rel={
                                  n.action_external_2
                                    ? "noopener noreferrer"
                                    : undefined
                                }
                                onClick={() => {
                                  if (n.is_dismissible)
                                    dismissNotification(
                                      n.cookie_id,
                                      n.dismiss_duration_hours,
                                    );
                                  setOpen(false);
                                }}
                                className={ROW_ACTION}
                              >
                                {n.action_label_2 || "View"}
                                {n.action_external_2 ? (
                                  <ExternalLink
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <ArrowRight
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                )}
                              </a>
                            )}
                          </div>
                        )}
                      </div>

                      {n.is_dismissible && (
                        <button
                          onClick={(e) => {
                            rememberRow(e.currentTarget);
                            dismissNotification(
                              n.cookie_id,
                              n.dismiss_duration_hours,
                            );
                          }}
                          data-notif-dismiss=""
                          className={ROW_DISMISS}
                          aria-label={`Dismiss ${n.title}`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
