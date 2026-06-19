"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  X,
  ArrowRight,
  AlertTriangle,
  Bell,
  ExternalLink,
  Info,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";
import { useAuth } from "@/components/providers/auth-provider";
import {
  STAFF_ROLES,
  APP_VERSION,
  APP_NAME,
  VERSION_COOKIE_NAME,
} from "@/lib/config/constants";
import { Sparkles } from "lucide-react";

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
  is_dismissible: boolean;
  dismiss_duration_hours: number | null;
  action_label: string | null;
  action_url: string | null;
  action_external: boolean;
  priority: number;
}

// ─── Backup Codes Modal (always shows as full-screen overlay) ────

export function BackupCodesModal() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [closing, setClosing] = useState(false);
  const { me } = useAuth();

  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") return pathname === p;
    return pathname.startsWith(p);
  });

  const show =
    !isPublicRoute && me?.userId && me?.backupCodesInvalid && !dismissed;

  if (!show) return null;

  const handleDismiss = () => {
    setClosing(true);
    setTimeout(() => setDismissed(true), 200);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm",
        closing
          ? "animate-out fade-out duration-200"
          : "animate-in fade-in duration-200",
      )}
    >
      <div
        className={cn(
          "relative w-full max-w-lg mx-4",
          closing
            ? "animate-out zoom-out-95 duration-200"
            : "animate-in zoom-in-95 duration-300",
        )}
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="h-1 w-full bg-destructive" />
          <div className="flex items-center justify-between px-5 pt-4 pb-0">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                Security Alert
              </span>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-8 pt-6 pb-4 flex flex-col items-center text-center">
            <div className="p-4 rounded-2xl mb-5 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-3 text-balance">
              Backup Codes Need Rotation
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm text-pretty">
              We upgraded our security to hash all 2FA backup codes. Your old
              backup codes will no longer work. Please regenerate them from your
              profile.
            </p>
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2.5 mt-3 w-full max-w-sm">
              <p className="text-xs text-destructive font-medium">
                Until you regenerate, you cannot use backup codes to log in if
                you lose your authenticator app.
              </p>
            </div>
          </div>
          <div className="px-8 pb-6 pt-3 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent"
              onClick={handleDismiss}
            >
              Remind Me Later
            </Button>
            <Button size="sm" asChild>
              <a href="/profile#account" onClick={handleDismiss}>
                Rotate Backup Codes
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
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
    icon: <Info className="h-4 w-4" />,
    bg: "bg-primary/10",
    border: "border-primary/30",
    text: "text-primary",
  },
  success: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4" />,
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
  },
  error: {
    icon: <AlertTriangle className="h-4 w-4" />,
    bg: "bg-destructive/10",
    border: "border-destructive/30",
    text: "text-destructive",
  },
};

// ─── Notification Bell (header dropdown) ─────────────────────────

export function NotificationBell() {
  const pathname = usePathname();
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showVersionNotif, setShowVersionNotif] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") return pathname === p;
    return pathname.startsWith(p);
  });

  const isStaff = me?.role && (STAFF_ROLE_VALUES as readonly string[]).includes(me.role);

  // Check if there's a new version (cookie-based)
  useEffect(() => {
    const lastSeenVersion = getCookie(VERSION_COOKIE_NAME);
    if (lastSeenVersion !== APP_VERSION) {
      // New version detected - show notification
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
          setDismissedIds(new Set(parsed.map(String)));
        }
      } catch {
        // Invalid cookie, ignore
      }
    }
  }, []);

  // Fetch notifications from API
  useEffect(() => {
    async function fetchNotifications() {
      try {
        const params = new URLSearchParams({
          authenticated: me?.userId ? "true" : "false",
          staff: isStaff ? "true" : "false",
        });
        const res = await fetch(`/api/v2/notifications/active?${params}`);
        if (res.ok) {
          const data = await res.json();
          // Only show "bell" type notifications in the bell dropdown
          setNotifications(
            data.filter((n: ApiNotification) => n.type === "bell"),
          );
        }
      } catch (err) {
        console.error("Failed to fetch notifications:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchNotifications();
    // Refetch every 5 minutes
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [me?.userId, isStaff]);

  // Mark component as hydrated after client mount
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Dismiss using unique cookie_id - each notification has its own cookie
  const dismissNotification = useCallback(
    (cookieId: string, durationHours: number | null) => {
      const maxAge = durationHours
        ? durationHours * 60 * 60
        : 60 * 60 * 24 * 365; // default 1 year
      setCookie(`dismissed_${cookieId}`, "1", maxAge);
      setDismissedIds((prev) => new Set([...prev, cookieId]));
    },
    [],
  );

  const dismissVersionNotif = useCallback(() => {
    setCookie(VERSION_COOKIE_NAME, APP_VERSION, 60 * 60 * 24 * 365); // 1 year
    setShowVersionNotif(false);
  }, []);

  // Filter out dismissed notifications (check both Set and cookie)
  const visibleNotifications = notifications.filter((n) => {
    if (dismissedIds.has(n.cookie_id)) return false;
    // Also check cookie directly for SSR/hydration
    if (
      typeof document !== "undefined" &&
      getCookie(`dismissed_${n.cookie_id}`) === "1"
    )
      return false;
    return true;
  });
  const count = visibleNotifications.length + (showVersionNotif ? 1 : 0);

  return (
    <div
      ref={ref}
      className={cn(
        "relative vr-auth-only",
        isPublicRoute && "!invisible !pointer-events-none",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
        aria-label={
          hydrated
            ? `Notifications${count > 0 ? ` (${count} unread)` : ""}`
            : "Notifications"
        }
        className="relative h-8 w-8"
      >
        <Bell className="h-4 w-4" />
        {hydrated && count > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed right-3 left-3 sm:left-auto sm:absolute sm:right-0 sm:w-80 top-14 sm:top-full sm:mt-2 z-50 overflow-hidden rounded-lg border border-border/50 bg-card shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
            <span className="text-sm font-medium text-foreground">
              Notifications
            </span>
            {count > 0 && !loading && (
              <span className="text-xs text-muted-foreground">{count} new</span>
            )}
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8 px-4">
              <Bell className="h-8 w-8 text-muted-foreground/30 mb-2 animate-pulse" />
              <p className="text-xs text-muted-foreground">Loading...</p>
            </div>
          ) : count === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <Bell className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-foreground">
                All caught up!
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                You're on top of everything
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {/* Version notification */}
              {showVersionNotif && (
                <div className="border-b border-border/40 p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 p-2 rounded-lg bg-primary/10 border border-primary/30 text-primary">
                      <Sparkles className="h-4 w-4" />
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
                          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1"
                        >
                          View Changelog
                          <ArrowRight className="h-3 w-3" />
                        </a>
                        <button
                          onClick={dismissVersionNotif}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={dismissVersionNotif}
                      className="flex-shrink-0 p-1 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                      aria-label="Dismiss version notification"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* API-driven notifications */}
              {visibleNotifications.map((n) => {
                const config = VARIANT_CONFIG[n.variant] || VARIANT_CONFIG.info;
                return (
                  <div
                    key={n.id}
                    className="border-b border-border/40 p-4 last:border-0 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex-shrink-0 p-2 rounded-lg border",
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
                        <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap mb-2">
                          {n.message}
                        </p>

                        <div className="flex items-center gap-2">
                          {n.action_url && (
                            <a
                              href={n.action_url}
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
                              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1"
                            >
                              {n.action_label || "View"}
                              {n.action_external ? (
                                <ExternalLink className="h-3 w-3" />
                              ) : (
                                <ArrowRight className="h-3 w-3" />
                              )}
                            </a>
                          )}
                          {n.is_dismissible && (
                            <button
                              onClick={() =>
                                dismissNotification(
                                  n.cookie_id,
                                  n.dismiss_duration_hours,
                                )
                              }
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      </div>

                      {n.is_dismissible && (
                        <button
                          onClick={() =>
                            dismissNotification(
                              n.cookie_id,
                              n.dismiss_duration_hours,
                            )
                          }
                          className="flex-shrink-0 p-1 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                          aria-label={`Dismiss ${n.title}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
