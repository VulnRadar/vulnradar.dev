"use client";

import React, { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  X,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  Megaphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { STAFF_ROLES } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";
import { matchesPathPattern } from "@/lib/notifications/match-path";

const STAFF_ROLE_VALUES = Object.values(STAFF_ROLES);

interface Notification {
  id: number;
  cookie_id: string;
  title: string;
  message: string;
  type: "banner" | "modal" | "toast" | "bell";
  variant: "info" | "success" | "warning" | "error";
  path_pattern: string | null;
  is_dismissible: boolean;
  dismiss_duration_hours?: number | null;
  action_label?: string | null;
  action_url?: string | null;
  action_external?: boolean;
}

// Cookie utilities for per-notification dismiss tracking
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || null;
  return null;
}

function setCookie(name: string, value: string, hours?: number | null): void {
  if (typeof document === "undefined") return;
  let expires = "";
  if (hours) {
    const date = new Date();
    date.setTime(date.getTime() + hours * 60 * 60 * 1000);
    expires = `; expires=${date.toUTCString()}`;
  } else {
    // Default to 30 days if no duration specified
    const date = new Date();
    date.setTime(date.getTime() + 30 * 24 * 60 * 60 * 1000);
    expires = `; expires=${date.toUTCString()}`;
  }
  document.cookie = `${name}=${value}${expires}; path=/; SameSite=Lax`;
}

function isNotificationDismissed(cookieId: string): boolean {
  return getCookie(`dismissed_${cookieId}`) === "1";
}

function dismissNotification(
  cookieId: string,
  durationHours?: number | null,
): void {
  setCookie(`dismissed_${cookieId}`, "1", durationHours);
}

// Design tokens matching site aesthetic - uses CSS variables for theme consistency
const variantConfig = {
  info: {
    bg: "bg-primary/10",
    border: "border-primary/20",
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    progressBar: "bg-primary",
    icon: Info,
  },
  success: {
    bg: "bg-[hsl(var(--success))]/10",
    border: "border-[hsl(var(--success))]/20",
    iconBg: "bg-[hsl(var(--success))]/15",
    iconColor: "text-[hsl(var(--success))]",
    progressBar: "bg-[hsl(var(--success))]",
    icon: CheckCircle2,
  },
  warning: {
    bg: "bg-[hsl(var(--warning))]/10",
    border: "border-[hsl(var(--warning))]/20",
    iconBg: "bg-[hsl(var(--warning))]/15",
    iconColor: "text-[hsl(var(--warning))]",
    progressBar: "bg-[hsl(var(--warning))]",
    icon: AlertTriangle,
  },
  error: {
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    iconBg: "bg-destructive/15",
    iconColor: "text-destructive",
    progressBar: "bg-destructive",
    icon: AlertCircle,
  },
};

// Banner - full width at top of page, matches header style
export function SiteBanner({ notification }: { notification: Notification }) {
  const [dismissed, setDismissed] = useState(() =>
    isNotificationDismissed(notification.cookie_id),
  );
  const [mounted, setMounted] = useState(false);
  const config = variantConfig[notification.variant];

  useEffect(() => setMounted(true), []);

  const handleDismiss = useCallback(() => {
    dismissNotification(
      notification.cookie_id,
      notification.dismiss_duration_hours,
    );
    setDismissed(true);
  }, [notification.cookie_id, notification.dismiss_duration_hours]);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        "relative border-b transition-all duration-300",
        config.bg,
        config.border,
        mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2",
      )}
    >
      {/* Left accent bar, full-bleed */}
      <div
        className={cn("absolute left-0 top-0 bottom-0 w-1", config.progressBar)}
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg",
              config.iconBg,
            )}
          >
            <Megaphone className={cn("h-4 w-4", config.iconColor)} />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-x-2 gap-y-0.5 min-w-0">
            {notification.title && (
              <span className="font-semibold text-sm text-foreground shrink-0">
                {notification.title}
              </span>
            )}
            <span className="text-sm text-foreground/80 truncate">
              {notification.message}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {notification.action_url && (
            <Button
              size="sm"
              asChild
              className={cn(
                "h-8 px-3 text-xs font-semibold",
                config.iconColor,
                config.bg,
                "border",
                config.border,
                "hover:opacity-90",
              )}
            >
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={
                  notification.action_external
                    ? "noopener noreferrer"
                    : undefined
                }
                className="flex items-center gap-1.5"
              >
                {notification.action_label || "Learn more"}
                {notification.action_external && (
                  <ExternalLink className="h-3 w-3" />
                )}
              </a>
            </Button>
          )}
          {notification.is_dismissible && (
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-md text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Modal - centered overlay matching site card/popover styles
export function SiteModal({
  notification,
  onClose,
}: {
  notification: Notification;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const config = variantConfig[notification.variant];
  const Icon = config.icon;

  useEffect(() => setMounted(true), []);

  const handleClose = useCallback(() => {
    if (notification.is_dismissible) {
      dismissNotification(
        notification.cookie_id,
        notification.dismiss_duration_hours,
      );
    }
    onClose();
  }, [
    notification.cookie_id,
    notification.dismiss_duration_hours,
    notification.is_dismissible,
    onClose,
  ]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop - matches site overlay style */}
      <div
        className={cn(
          "absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-200",
          mounted ? "opacity-100" : "opacity-0",
        )}
        onClick={notification.is_dismissible ? handleClose : undefined}
      />

      {/* Modal card */}
      <div
        className={cn(
          "relative w-full max-w-md rounded-lg border border-border bg-card shadow-lg transition-all duration-200",
          mounted ? "opacity-100 scale-100" : "opacity-0 scale-95",
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-start gap-3 p-4 border-b border-border",
            config.bg,
          )}
        >
          <div className={cn("flex-shrink-0 p-2 rounded-md", config.iconBg)}>
            <Icon className={cn("h-5 w-5", config.iconColor)} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            {notification.title && (
              <h2 className="text-base font-semibold text-foreground">
                {notification.title}
              </h2>
            )}
          </div>
          {notification.is_dismissible && (
            <button
              onClick={handleClose}
              className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {notification.message}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 pt-0">
          {notification.is_dismissible && (
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Dismiss
            </Button>
          )}
          {notification.action_url && (
            <Button size="sm" asChild>
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={
                  notification.action_external
                    ? "noopener noreferrer"
                    : undefined
                }
                className="flex items-center gap-1.5"
              >
                {notification.action_label || "Learn more"}
                {notification.action_external && (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Toast - compact notification in corner
export function SiteToast({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: () => void;
}) {
  const [dismissed, setDismissed] = useState(() =>
    isNotificationDismissed(notification.cookie_id),
  );
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const config = variantConfig[notification.variant];
  const Icon = config.icon;

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      dismissNotification(
        notification.cookie_id,
        notification.dismiss_duration_hours,
      );
      setDismissed(true);
      onDismiss();
    }, 150);
  }, [notification.cookie_id, notification.dismiss_duration_hours, onDismiss]);

  // Auto-dismiss with progress bar
  useEffect(() => {
    if (!notification.is_dismissible) return;

    const duration = 6000;
    const interval = 50;
    const decrement = (interval / duration) * 100;

    const progressTimer = setInterval(() => {
      setProgress((prev) => Math.max(0, prev - decrement));
    }, interval);

    const dismissTimer = setTimeout(handleDismiss, duration);

    return () => {
      clearInterval(progressTimer);
      clearTimeout(dismissTimer);
    };
  }, [notification.is_dismissible, handleDismiss]);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-lg border border-border bg-card shadow-lg overflow-hidden transition-all duration-150",
        exiting
          ? "opacity-0 translate-x-4 scale-95"
          : "opacity-100 translate-x-0 scale-100",
      )}
    >
      {/* Progress bar */}
      {notification.is_dismissible && (
        <div className="h-0.5 bg-muted">
          <div
            className={cn(
              "h-full transition-all duration-100 ease-linear",
              config.progressBar,
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              "flex-shrink-0 p-1.5 rounded-md mt-0.5",
              config.iconBg,
            )}
          >
            <Icon className={cn("h-4 w-4", config.iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            {notification.title && (
              <p className="text-sm font-medium text-foreground">
                {notification.title}
              </p>
            )}
            <p
              className={cn(
                "text-sm text-muted-foreground leading-snug whitespace-pre-wrap",
                notification.title && "mt-0.5",
              )}
            >
              {notification.message}
            </p>
            {notification.action_url && (
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={
                  notification.action_external
                    ? "noopener noreferrer"
                    : undefined
                }
                className="inline-flex items-center gap-1 text-sm font-medium text-primary mt-1.5 hover:underline underline-offset-2"
              >
                {notification.action_label || "Learn more"}
                {notification.action_external && (
                  <ExternalLink className="h-3 w-3" />
                )}
              </a>
            )}
          </div>
          {notification.is_dismissible && (
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Dismiss toast"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Main component that renders all active notifications
export function SiteNotifications({
  notifications,
}: {
  notifications: Notification[];
}) {
  const [activeModal, setActiveModal] = useState<Notification | null>(null);
  const [toastQueue, setToastQueue] = useState<Notification[]>([]);
  const pathname = usePathname();

  // Filter out dismissed notifications, anything whose page filter doesn't
  // match the current route, and separate by type.
  const onThisPage = notifications.filter(
    (n) =>
      matchesPathPattern(pathname, n.path_pattern) &&
      !isNotificationDismissed(n.cookie_id),
  );
  const banners = onThisPage.filter((n) => n.type === "banner");
  const modals = onThisPage.filter((n) => n.type === "modal");
  const toasts = onThisPage.filter((n) => n.type === "toast");

  // The scanner app header (components/scanner/header.tsx) is
  // `position: fixed`, so it always paints at viewport top regardless of
  // where a banner sits in the DOM -- a banner in normal flow would render
  // right behind it. Publish the banner stack's real height as a CSS
  // variable so the fixed header (and its layout spacer) can offset below
  // it instead of covering it. Sticky headers (landing, docs) don't need
  // this: they already sit after the banner in document flow.
  const bannerStackRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = bannerStackRef.current;
    const root = document.documentElement;
    if (!el || banners.length === 0) {
      root.style.setProperty("--vr-banner-h", "0px");
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      root.style.setProperty("--vr-banner-h", `${entry.contentRect.height}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--vr-banner-h", "0px");
    };
  }, [banners.length]);

  // Show the highest priority modal that hasn't been dismissed
  useEffect(() => {
    if (modals.length > 0 && !activeModal) {
      setActiveModal(modals[0]);
    }
  }, [modals, activeModal]);

  // Initialize toast queue
  useEffect(() => {
    if (toasts.length > 0 && toastQueue.length === 0) {
      setToastQueue(toasts);
    }
  }, [toasts, toastQueue.length]);

  const removeToast = useCallback((id: number) => {
    setToastQueue((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <>
      {/* Render all active banners - each has independent dismiss state.
          Fixed + above the app header's z-50 so it's never hidden behind
          it; see the --vr-banner-h effect above. */}
      {banners.length > 0 && (
        <div ref={bannerStackRef} className="fixed top-0 left-0 right-0 z-[60]">
          {banners.map((notification) => (
            <SiteBanner key={notification.id} notification={notification} />
          ))}
        </div>
      )}

      {/* Render one modal at a time */}
      {activeModal && (
        <SiteModal
          notification={activeModal}
          onClose={() => {
            // Find next modal to show
            const nextModal = modals.find(
              (m) =>
                m.id !== activeModal.id &&
                !isNotificationDismissed(m.cookie_id),
            );
            setActiveModal(nextModal || null);
          }}
        />
      )}

      {/* Toast container - bottom right */}
      {toastQueue.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toastQueue.slice(0, 3).map((notification) => (
            <SiteToast
              key={notification.id}
              notification={notification}
              onDismiss={() => removeToast(notification.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Wrapper component that fetches notifications and renders them
export function SiteNotificationsWrapper() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { me } = useAuth();
  const isStaff =
    me?.role && (STAFF_ROLE_VALUES as readonly string[]).includes(me.role);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        // Audience targeting ("Logged In Only" / "Guests Only" / "Staff
        // Only") is enforced server-side based on these two params. Without
        // them the API defaults both to false, which silently breaks every
        // non-"all" audience: "authenticated" never matches, "unauthenticated"
        // matches everyone (including logged-in users), and "staff"/"admin"
        // never match.
        const params = new URLSearchParams({
          authenticated: me?.userId ? "true" : "false",
          staff: isStaff ? "true" : "false",
        });
        const res = await fetch(`/api/v3/notifications/active?${params}`);
        if (res.ok) {
          const data = await res.json();
          // API returns array directly, not { notifications: [...] }
          const allNotifs = Array.isArray(data)
            ? data
            : data.notifications || [];
          // Filter to only banner, modal, toast types (bell is handled by NotificationCenter)
          const siteNotifs = allNotifs.filter(
            (n: Notification) =>
              n.type === "banner" || n.type === "modal" || n.type === "toast",
          );
          setNotifications(siteNotifs);
        }
      } catch {
        // Silent fail
      }
    };

    fetchNotifications();
  }, [me?.userId, isStaff]);

  if (notifications.length === 0) return null;

  return <SiteNotifications notifications={notifications} />;
}
