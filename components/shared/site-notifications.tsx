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
import { cn, safeHref } from "@/lib/ui/utils";
import { STAFF_ROLES } from "@/lib/config/client-constants";
import { useAuth } from "@/components/providers/auth-provider";
import { matchesPathPattern } from "@/lib/notifications/match-path";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";
import { fetchActiveNotifications } from "@/components/shared/active-notifications";

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
  action_label_2?: string | null;
  action_url_2?: string | null;
  action_external_2?: boolean;
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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- flips true once after mount so the entry transition doesn't play on the very first paint (unavailable to know during SSR)
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
        // Opaque bg-background as the real background, with config.bg (an
        // alpha color) layered on top as its own painted layer -- both
        // layers belong to this fixed banner, so the alpha blends against
        // the opaque layer beneath it, not against whatever page content is
        // scrolling underneath. A single alpha background here would let
        // scrolled content show straight through since this is
        // position:fixed above it.
        "relative border-b bg-background transition-all duration-300",
        config.border,
        mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2",
      )}
    >
      <div
        className={cn("absolute inset-0 pointer-events-none", config.bg)}
        aria-hidden="true"
      />

      {/* Left accent bar, full-bleed */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 pointer-events-none",
          config.progressBar,
        )}
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-start sm:items-center gap-3 sm:gap-4">
        <div
          className={cn(
            "shrink-0 flex items-center justify-center h-8 w-8 rounded-lg",
            config.iconBg,
          )}
        >
          <Megaphone className={cn("h-4 w-4", config.iconColor)} />
        </div>

        {/* Middle block: text stacks above the action buttons on mobile,
            sits inline with them on larger screens. min-w-0 lets the text
            truncate/wrap instead of forcing the row wider than the viewport. */}
        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-x-2 gap-y-0.5 min-w-0">
            {notification.title && (
              <span className="font-semibold text-sm text-foreground shrink-0">
                {notification.title}
              </span>
            )}
            <span className="text-sm text-foreground/80 wrap-break-word sm:truncate">
              {notification.message}
            </span>
          </div>

          {(notification.action_url || notification.action_url_2) && (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
                    href={safeHref(notification.action_url)}
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
              {notification.action_url_2 && (
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className="h-8 px-3 text-xs font-semibold"
                >
                  <a
                    href={safeHref(notification.action_url_2)}
                    target={notification.action_external_2 ? "_blank" : "_self"}
                    rel={
                      notification.action_external_2
                        ? "noopener noreferrer"
                        : undefined
                    }
                    className="flex items-center gap-1.5"
                  >
                    {notification.action_label_2 || "Learn more"}
                    {notification.action_external_2 && (
                      <ExternalLink className="h-3 w-3" />
                    )}
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>

        {notification.is_dismissible && (
          <button
            onClick={handleDismiss}
            className="shrink-0 flex items-center justify-center h-11 w-11 sm:h-7 sm:w-7 rounded-md text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-colors"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        )}
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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- flips true once after mount so the entry transition doesn't play on the very first paint (unavailable to know during SSR)
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

  /* a11y. This was the one hand-rolled overlay in the product not wired to
     useModalA11y: no role="dialog", no aria-modal, no Escape, no focus moved
     in, no focus restored on close, and the page behind neither aria-hidden
     nor inert. It renders from the root layout, so it could appear over any
     page, and a keyboard user was left with focus on a control now sitting
     under an opaque scrim (SC 2.4.3, 2.4.11, 4.1.2).

     Escape is routed at handleClose rather than onClose, which matters for a
     notification published with is_dismissible false: that path deliberately
     writes no dismissal cookie, so the announcement comes back on the next
     load, but the user is not sealed in front of it with no keyboard way out
     (SC 2.1.2 -- and adding the focus trap this hook brings is precisely what
     makes 2.1.2 bite, since before it there was no trap to escape from).

     aria-labelledby has to point at something that exists. `title` is
     optional on a notification, so when it is absent the message paragraph
     carries titleProps and becomes the accessible name; when it is present
     the h2 names the dialog and the message describes it. */
  const { dialogProps, titleProps, descriptionProps } = useModalA11y({
    open: true,
    onClose: handleClose,
    hasDescription: !!notification.title,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop - matches site overlay style */}
      <div
        className={cn(
          "absolute inset-0 bg-background/80 backdrop-blur-xs transition-opacity duration-200",
          mounted ? "opacity-100" : "opacity-0",
        )}
        onClick={notification.is_dismissible ? handleClose : undefined}
      />

      {/* Modal card. The message is admin-authored and of arbitrary length,
          and this card had neither a height cap nor a scroll region: a long
          announcement ran off both edges of a phone, and because the parent
          is a centring flex container rather than a scroller there was no way
          to reach the rest of it or the action buttons under it. Header and
          footer stay pinned, the message scrolls between them. dvh, not vh,
          because 100vh on iOS Safari is the large viewport. */}
      <div
        {...dialogProps}
        className={cn(
          "relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-lg border border-border bg-card shadow-lg transition-all duration-200 focus:outline-hidden",
          mounted ? "opacity-100 scale-100" : "opacity-0 scale-95",
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex shrink-0 items-start gap-3 p-4 border-b border-border",
            config.bg,
          )}
        >
          <div className={cn("shrink-0 p-2 rounded-md", config.iconBg)}>
            <Icon className={cn("h-5 w-5", config.iconColor)} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            {notification.title && (
              <h2
                {...titleProps}
                className="text-base font-semibold text-foreground"
              >
                {notification.title}
              </h2>
            )}
          </div>
          {notification.is_dismissible && (
            <button
              onClick={handleClose}
              className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <p
            {...(notification.title ? descriptionProps : titleProps)}
            className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap"
          >
            {notification.message}
          </p>
        </div>

        {/* Footer: the top-right X already closes the modal (it renders under
            the same is_dismissible condition the old "Dismiss" button used),
            so we don't repeat a redundant "Dismiss" button here. Only action
            buttons live in the footer, and it's omitted entirely when the
            notification has no actions, leaving the X as the way to close.
            Buttons stack full width on mobile so long labels don't clip. */}
        {(notification.action_url || notification.action_url_2) && (
          <div className="flex shrink-0 flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 p-4 pt-0">
            {notification.action_url_2 && (
              <Button
                size="sm"
                variant="outline"
                asChild
                className="w-full sm:w-auto"
              >
                <a
                  href={safeHref(notification.action_url_2)}
                  target={notification.action_external_2 ? "_blank" : "_self"}
                  rel={
                    notification.action_external_2
                      ? "noopener noreferrer"
                      : undefined
                  }
                  className="flex items-center justify-center gap-1.5"
                >
                  {notification.action_label_2 || "Learn more"}
                  {notification.action_external_2 && (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                </a>
              </Button>
            )}
            {notification.action_url && (
              <Button size="sm" asChild className="w-full sm:w-auto">
                <a
                  href={safeHref(notification.action_url)}
                  target={notification.action_external ? "_blank" : "_self"}
                  rel={
                    notification.action_external
                      ? "noopener noreferrer"
                      : undefined
                  }
                  className="flex items-center justify-center gap-1.5"
                >
                  {notification.action_label || "Learn more"}
                  {notification.action_external && (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                </a>
              </Button>
            )}
          </div>
        )}
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
        "pointer-events-auto w-full max-w-[calc(100vw-2rem)] sm:max-w-sm rounded-lg border border-border bg-card shadow-lg overflow-hidden transition-all duration-150",
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
            className={cn("shrink-0 p-1.5 rounded-md mt-0.5", config.iconBg)}
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
                "text-sm text-muted-foreground leading-snug whitespace-pre-wrap wrap-break-word",
                notification.title && "mt-0.5",
              )}
            >
              {notification.message}
            </p>
            {(notification.action_url || notification.action_url_2) && (
              <div className="flex items-center gap-3 mt-1.5">
                {notification.action_url && (
                  <a
                    href={safeHref(notification.action_url)}
                    target={notification.action_external ? "_blank" : "_self"}
                    rel={
                      notification.action_external
                        ? "noopener noreferrer"
                        : undefined
                    }
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2"
                  >
                    {notification.action_label || "Learn more"}
                    {notification.action_external && (
                      <ExternalLink className="h-3 w-3" />
                    )}
                  </a>
                )}
                {notification.action_url_2 && (
                  <a
                    href={safeHref(notification.action_url_2)}
                    target={notification.action_external_2 ? "_blank" : "_self"}
                    rel={
                      notification.action_external_2
                        ? "noopener noreferrer"
                        : undefined
                    }
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2"
                  >
                    {notification.action_label_2 || "Learn more"}
                    {notification.action_external_2 && (
                      <ExternalLink className="h-3 w-3" />
                    )}
                  </a>
                )}
              </div>
            )}
          </div>
          {notification.is_dismissible && (
            <button
              onClick={handleDismiss}
              // a11y (SC 2.5.8): p-1 around a 14px icon is a 22x22 target.
              // The modal's close button above uses a 16px icon and lands
              // exactly on 24; this one did not, so it gets an explicit box.
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derives which modal to show from the modals prop; self-limiting, only fires while none is active
      setActiveModal(modals[0]);
    }
  }, [modals, activeModal]);

  // Initialize toast queue
  useEffect(() => {
    if (toasts.length > 0 && toastQueue.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the toast queue from the toasts prop; self-limiting, only fires while the queue is empty
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
          it; see the --vr-banner-h effect above. Offset below
          --vr-imp-banner-h (components/admin/impersonation-banner.tsx) so
          the two banner systems stack instead of painting on top of each
          other when both happen to be active at once. */}
      {banners.length > 0 && (
        <div
          ref={bannerStackRef}
          className="fixed left-0 right-0 z-60"
          style={{ top: "var(--vr-imp-banner-h, 0px)" }}
        >
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

      {/* Toast container - bottom right. bottom offsets by --vr-cookie-h
          (components/shared/cookie-notice.tsx) because that bar is z-60 and
          mounted after this one, so at a flat bottom-4 a toast landed behind
          it on a first visit, which is exactly when a toast is most likely. */}
      {toastQueue.length > 0 && (
        <div className="fixed bottom-[calc(1rem+var(--vr-cookie-h,0px))] right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 pointer-events-none transition-[bottom] duration-300">
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
        // never match. They are the shared fetcher's cache key for the same
        // reason.
        //
        // This wrapper and the notification bell are both mounted in the root
        // layout and both want this one payload, so they went out as two
        // identical requests on every page view, for anonymous visitors on the
        // marketing pages too. One request now, filtered twice.
        const allNotifs = await fetchActiveNotifications<Notification>(
          !!me?.userId,
          !!isStaff,
        );
        // Filter to only banner, modal, toast types (bell is handled by NotificationCenter)
        setNotifications(
          allNotifs.filter(
            (n) =>
              n.type === "banner" || n.type === "modal" || n.type === "toast",
          ),
        );
      } catch {
        // Silent fail
      }
    };

    fetchNotifications();
  }, [me?.userId, isStaff]);

  if (notifications.length === 0) return null;

  return <SiteNotifications notifications={notifications} />;
}
