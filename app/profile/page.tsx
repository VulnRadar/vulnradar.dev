"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { cn } from "@/lib/ui/utils";
import { API } from "@/lib/config/constants";
import { refreshAuthCache } from "@/components/providers/auth-provider";
import {
  useQueryParam,
  getQueryParam,
  setQueryParams,
} from "@/lib/ui/url-state";

const ImageCropDialog = dynamic(
  () =>
    import("@/components/modals/image-crop-dialog").then((m) => ({
      default: m.ImageCropDialog,
    })),
  { ssr: false },
);
import { ProfileGeneralTab } from "@/components/profile/tabs/profile-general-tab";
import { ProfileSecurityTab } from "@/components/profile/tabs/profile-security-tab";
import { ProfileSocialTab } from "@/components/profile/tabs/profile-social-tab";
import { ProfileBillingTab } from "@/components/profile/tabs/profile-billing-tab";
import { ProfileDeveloperTab } from "@/components/profile/tabs/profile-developer-tab";
import { ProfileNotificationsTab } from "@/components/profile/tabs/profile-notifications-tab";
import { ProfilePrivacyTab } from "@/components/profile/tabs/profile-privacy-tab";
import { ProfileAiSettingsTab } from "@/components/profile/tabs/profile-ai-settings-tab";
import type {
  ProfileUser,
  ApiKey,
  BillingInfo,
  DataRequestInfo,
  WebhookItem,
  ScheduleItem,
  NotificationPrefs,
  ProfileTab,
  PendingChanges,
} from "@/components/profile/types";
import {
  Check,
  Key,
  AlertTriangle,
  Shield,
  UserCog,
  Lock,
  Save,
  Bell,
  Share2,
  CreditCard,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { ProfileSkeleton } from "@/components/profile/profile-skeleton";
import {
  SaveConfirmationModal,
  type ChangeItem,
} from "@/components/shared/save-confirmation-modal";

// Types imported from @/components/profile/types

export default function ProfilePage() {
  return <ProfileContent />;
}

function ProfileContent() {
  const router = useRouter();
  const VALID_TABS: ProfileTab[] = [
    "general",
    "security",
    "social",
    "billing",
    "developer",
    "notifications",
    "privacy",
    "ai",
  ];
  const isValidProfileTab = (v: string | null): v is ProfileTab =>
    v !== null && VALID_TABS.includes(v as ProfileTab);
  const [activeProfileTab, setActiveProfileTabRaw] = useQueryParam<string>(
    "tab",
    "general",
  );
  const activeProfileTabSafe: ProfileTab = isValidProfileTab(activeProfileTab)
    ? (activeProfileTab as ProfileTab)
    : "general";

  // admin: always reflect the current tab in the URL — even on first
  // load when no tab has been clicked. Otherwise the URL is
  // /profile with no ?tab= which is ambiguous (the default could
  // change in the future).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.search.includes("tab=")) {
      setActiveProfileTabRaw(activeProfileTabSafe);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // app/api/v3/auth/oauth/[provider]/callback/route.ts's handleGithubConnect
  // (the "grant repo access" flow, kicked off from the Social tab's GitHub
  // card) redirects to /profile?tab=developer&dtab=github with either
  // github_connected=true or github_error=<reason> -- a fixed target this
  // page cannot change (that callback route belongs to a different part of
  // the OAuth system). Repo access now lives on the Social tab, not
  // Developer, so catch that specific landing here (mounted regardless of
  // which tab is active) and redirect the user to where the outcome is
  // actually visible instead of leaving them on Developer's now-unrelated
  // "github" dtab value.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (getQueryParam("dtab") !== "github") return;

    const connected = getQueryParam("github_connected") === "true";
    const errorCode = getQueryParam("github_error");
    if (!connected && !errorCode) return;

    const GITHUB_CONNECT_ERRORS: Record<string, string> = {
      denied: "Granting repo access was cancelled.",
      invalid: "The GitHub callback was missing required parameters.",
      invalid_state:
        "That link expired or was already used. Try granting access again.",
      expired: "That link expired. Try granting access again.",
      session_expired:
        "Your session expired before GitHub redirected back. Log in and try again.",
      not_configured: "GitHub integration is not configured on this server.",
      failed: "Could not grant repo access. Try again.",
    };

    if (connected) {
      setSuccess(
        "Repo access granted. Pick which repos to scan on the Repos page.",
      );
    } else if (errorCode) {
      setError(
        GITHUB_CONNECT_ERRORS[errorCode] ?? "Could not grant repo access.",
      );
    }

    // One replaceState covering both the tab switch and the param
    // cleanup -- setQueryParams emits a change event for "tab" too, which
    // the useQueryParam hook driving activeProfileTab already listens for,
    // so this doesn't need a separate setActiveProfileTabRaw call (that
    // would pushState a second history entry on top of this one).
    setQueryParams(
      {
        tab: "social",
        dtab: null,
        github_connected: null,
        github_error: null,
      },
      { replace: true },
    );
    // Runs once on mount to consume the redirect's query params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      setPendingChanges({});
      setShowSaveModal(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Change tab — just update the query param, no page reload
  const handleProfileTabChange = (tab: ProfileTab) => {
    // Clear any pending changes when switching tabs
    if (Object.keys(pendingChanges).length > 0 || showSaveModal) {
      setPendingChanges({});
      setShowSaveModal(false);
    }
    // dtab is a sub-tab that only means something within whichever tab set
    // it (Developer's api-keys/webhooks/schedules, the GitHub-connect
    // redirect's "github"). Switching the top-level tab without clearing it
    // left it stuck in the URL -- e.g. tab=developer&dtab=schedules ->
    // tab=ai still carried dtab=schedules, and switching back to Developer
    // later would jump straight to Schedules instead of the actual default.
    // setQueryParams updates both atomically and emits change events for
    // both keys, which the useQueryParam hooks driving activeProfileTab
    // (here) and Developer's own dtab default ("api-keys") already listen
    // for, so clearing it here is enough to land back on the real default.
    setQueryParams({ tab, dtab: null });
  };
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // API key state is now managed in ProfileDeveloperTab component

  // Profile editing state
  const [savingProfile, setSavingProfile] = useState(false);

  // Unified pending changes system
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [discardKey, setDiscardKey] = useState(0); // Incremented to trigger child component resets
  const [saveKey, setSaveKey] = useState(0); // Incremented after save to update original values

  // Data request and delete state are now managed in ProfilePrivacyTab component

  // Billing state is now managed in ProfileBillingTab component

  // Avatar state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  async function handleCroppedAvatar(croppedDataUrl: string) {
    setUploadingAvatar(true);
    setError(null);
    try {
      const res = await fetch(API.AUTH.UPDATE, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: croppedDataUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
      } else {
        setUser((prev) =>
          prev ? { ...prev, avatarUrl: data.avatarUrl } : prev,
        );
        // Same staleness fix as saveAllPendingChanges below: this only
        // updates this page's own local `user` state, not the app-wide
        // useAuth() cache the nav avatar and everywhere else reads from.
        refreshAuthCache();
        setSuccess("Profile picture updated.");
        setCropDialogOpen(false);
        setCropImageSrc(null);
      }
    } catch {
      setError("Failed to upload profile picture.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  // Pre-loaded data for tabs
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null);
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
  const [dataReqInfo, setDataReqInfo] = useState<DataRequestInfo | null>(null);
  const [scansPrivateByDefault, setScansPrivateByDefault] = useState<
    boolean | null
  >(null);
  const [sharePubliclyListedByDefault, setSharePubliclyListedByDefault] =
    useState<boolean | null>(null);

  const fetchData = useCallback(async () => {
    try {
      // Fetch all data in parallel for instant loading
      const [
        userRes,
        keysRes,
        webhooksRes,
        schedulesRes,
        notifsRes,
        billingRes,
        dataReqRes,
        privacyRes,
        sharePrivacyRes,
      ] = await Promise.all([
        fetch(API.AUTH.ME),
        fetch(API.KEYS),
        fetch(API.WEBHOOKS),
        fetch(API.SCHEDULES),
        fetch(API.ACCOUNT_NOTIFICATIONS),
        fetch(API.BILLING),
        fetch(API.DATA_REQUEST),
        fetch(API.ACCOUNT_PRIVACY),
        fetch(API.ACCOUNT_SHARE_PRIVACY),
      ]);

      if (!userRes.ok) {
        router.push("/login");
        return;
      }

      const userData = await userRes.json();
      setUser(userData);

      // Parse developer tab data
      const keysData = keysRes.ok ? await keysRes.json() : { keys: [] };
      const webhooksData = webhooksRes.ok
        ? await webhooksRes.json()
        : { webhooks: [] };
      const schedulesData = schedulesRes.ok
        ? await schedulesRes.json()
        : { schedules: [] };
      setApiKeys(Array.isArray(keysData) ? keysData : keysData.keys || []);
      setWebhooks(
        Array.isArray(webhooksData)
          ? webhooksData
          : webhooksData.webhooks || [],
      );
      setSchedules(
        Array.isArray(schedulesData)
          ? schedulesData
          : schedulesData.schedules || [],
      );

      // Parse notifications data
      if (notifsRes.ok) {
        const notifsData = await notifsRes.json();
        setNotifPrefs(notifsData);
      }

      // Parse billing data
      if (billingRes.ok) {
        const billingData = await billingRes.json();
        setBillingInfo(billingData);
      }

      // Parse data request info
      if (dataReqRes.ok) {
        const dataReqData = await dataReqRes.json();
        setDataReqInfo(dataReqData);
      }

      // Parse the account-level scan privacy default
      if (privacyRes.ok) {
        const privacyData = await privacyRes.json();
        setScansPrivateByDefault(Boolean(privacyData.scansPrivateByDefault));
      }

      // Parse the account-level Public Scans directory listing default
      if (sharePrivacyRes.ok) {
        const sharePrivacyData = await sharePrivacyRes.json();
        setSharePubliclyListedByDefault(
          sharePrivacyData.sharePubliclyListedByDefault ?? true,
        );
      }
    } catch {
      setError("Failed to load profile data.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Clear messages after 5 seconds
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(t);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // ---- Account handlers ----
  // Data request and delete handlers are now managed in ProfilePrivacyTab component

  // Unified save all changes
  async function saveAllPendingChanges() {
    setSavingProfile(true);
    setError(null);

    try {
      // Save name if changed
      if (pendingChanges.name !== undefined) {
        const res = await fetch(API.AUTH.UPDATE, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: pendingChanges.name }),
        });
        if (res.ok) {
          const data = await res.json();
          setUser((u) => (u ? { ...u, name: data.name } : u));
        }
      }

      // Save email if changed
      if (pendingChanges.email !== undefined) {
        const res = await fetch(API.AUTH.UPDATE, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: pendingChanges.email }),
        });
        if (res.ok) {
          const data = await res.json();
          setUser((u) => (u ? { ...u, email: data.email } : u));
        }
      }

      // Save notification preferences if changed
      if (pendingChanges.notifications) {
        await fetch(API.ACCOUNT_NOTIFICATIONS, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pendingChanges.notifications),
        });
      }

      // Save the account-level scan privacy default if changed
      if (pendingChanges.scansPrivateByDefault !== undefined) {
        const res = await fetch(API.ACCOUNT_PRIVACY, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scansPrivateByDefault: pendingChanges.scansPrivateByDefault,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setScansPrivateByDefault(Boolean(data.scansPrivateByDefault));
        }
      }

      // Save the account-level Public Scans directory listing default, if changed
      if (pendingChanges.sharePubliclyListedByDefault !== undefined) {
        const res = await fetch(API.ACCOUNT_SHARE_PRIVACY, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sharePubliclyListedByDefault:
              pendingChanges.sharePubliclyListedByDefault,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setSharePubliclyListedByDefault(
            Boolean(data.sharePubliclyListedByDefault),
          );
        }
      }

      // Every branch above updates only this page's own local state
      // (setUser, setScansPrivateByDefault, ...) -- none of them touch the
      // app-wide useAuth() SWR cache for /api/v3/auth/me, which is what
      // app/dashboard/page.tsx (and the nav, and everything else reading
      // useAuth().me) actually reads from. That cache has a 5-minute
      // dedupingInterval and never revalidates on focus, so without this,
      // a just-saved change (e.g. "scans are private by default", which
      // seeds the dashboard scan form's "Keep this scan private" toggle)
      // stayed invisible to every other page for up to 5 minutes after
      // saving, reading as "the toggle doesn't even seem to be on."
      refreshAuthCache();

      setPendingChanges({});
      setShowSaveModal(false);
      setSaveKey((prev) => prev + 1); // Trigger child components to update their original values
      setSuccess(`Changes saved successfully.`);
    } catch {
      setError("Failed to save some changes.");
    } finally {
      setSavingProfile(false);
    }
  }

  // Check for pending changes
  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  // Build change items for modal - include all types of changes
  const pendingChangeItems: ChangeItem[] = [
    ...(pendingChanges.name !== undefined
      ? [
          {
            field: "name",
            label: "Display Name",
            oldValue: user?.name || "",
            newValue: pendingChanges.name as string,
          },
        ]
      : []),
    ...(pendingChanges.email !== undefined
      ? [
          {
            field: "email",
            label: "Email Address",
            oldValue: user?.email || "",
            newValue: pendingChanges.email as string,
          },
        ]
      : []),
    // Include notification preference changes
    ...(pendingChanges.notifications
      ? Object.entries(
          pendingChanges.notifications as Record<string, boolean>,
        ).map(([key, value]) => ({
          field: key,
          label: key
            .replace("email_", "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          oldValue: value ? "Disabled" : "Enabled",
          newValue: value ? "Enabled" : "Disabled",
        }))
      : []),
    ...(pendingChanges.scansPrivateByDefault !== undefined
      ? [
          {
            field: "scansPrivateByDefault",
            label: "Scans Are Private By Default",
            oldValue: pendingChanges.scansPrivateByDefault ? "Off" : "On",
            newValue: pendingChanges.scansPrivateByDefault ? "On" : "Off",
          },
        ]
      : []),
    ...(pendingChanges.sharePubliclyListedByDefault !== undefined
      ? [
          {
            field: "sharePubliclyListedByDefault",
            label: "List New Shares In Public Scans By Default",
            oldValue: pendingChanges.sharePubliclyListedByDefault
              ? "Off"
              : "On",
            newValue: pendingChanges.sharePubliclyListedByDefault
              ? "On"
              : "Off",
          },
        ]
      : []),
  ];

  // Discard all pending changes
  function discardAllChanges() {
    setPendingChanges({});
    setDiscardKey((prev) => prev + 1); // Trigger child components to reset
  }

  // ---- Helpers ----

  if (loading) {
    return <ProfileSkeleton />;
  }

  const TABS = [
    {
      id: "general" as ProfileTab,
      label: "General",
      icon: <UserCog className="h-4 w-4" />,
    },
    {
      id: "security" as ProfileTab,
      label: "Security",
      icon: <Lock className="h-4 w-4" />,
    },
    {
      id: "social" as ProfileTab,
      label: "Social",
      icon: <Share2 className="h-4 w-4" />,
    },
    {
      id: "billing" as ProfileTab,
      label: "Billing",
      icon: <CreditCard className="h-4 w-4" />,
    },
    {
      id: "developer" as ProfileTab,
      label: "Developer",
      icon: <Key className="h-4 w-4" />,
    },
    {
      id: "notifications" as ProfileTab,
      label: "Notifications",
      icon: <Bell className="h-4 w-4" />,
    },
    {
      id: "privacy" as ProfileTab,
      label: "Privacy",
      icon: <Shield className="h-4 w-4" />,
    },
    {
      id: "ai" as ProfileTab,
      label: "AI",
      icon: <Bot className="h-4 w-4" />,
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-6 sm:gap-8 min-w-0">
        {/* Page Header — top-left pattern (matches Admin / Shared pages) */}
        <div className="mb-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Account Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your account settings and preferences
          </p>
        </div>

        {/* Toast messages */}
        {(error || success) && (
          <div
            role={error ? "alert" : "status"}
            aria-live={error ? "assertive" : "polite"}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl text-sm border",
              error
                ? "bg-destructive/10 text-destructive border-destructive/20"
                : "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.2)]",
            )}
          >
            {error ? (
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="flex-1">{error || success}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccess(null);
              }}
              className="text-xs font-medium hover:underline opacity-70 hover:opacity-100 transition-opacity rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Two-column layout: Sidebar + Content */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Sidebar Navigation */}
          <aside className="lg:w-48 lg:shrink-0">
            {/* Mobile: Scrollable horizontal tab bar */}
            <div className="lg:hidden overflow-x-auto scrollbar-hide -mx-4 px-4 border-b border-border/80">
              <div className="flex gap-0.5 min-w-max">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleProfileTabChange(tab.id)}
                    className={cn(
                      "flex items-center gap-2 px-3.5 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px",
                      activeProfileTabSafe === tab.id
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Desktop: Vertical sidebar — self-start is required for sticky to work in a flex row.
                top offset grows by --vr-banner-h (site-notifications.tsx) when a banner is
                showing, since the fixed Header above shifts down to stay below it too. */}
            <nav className="hidden lg:flex flex-col gap-0.5 sticky top-[calc(5rem+var(--vr-banner-h,0px))] self-start transition-[top] duration-300">
              {TABS.map((tab) => (
                <a
                  key={tab.id}
                  href={`/profile?tab=${tab.id}`}
                  onClick={(e) => {
                    if (!e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      handleProfileTabChange(tab.id);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-lg transition-colors",
                    activeProfileTabSafe === tab.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </a>
              ))}
            </nav>
          </aside>

          {/* Main Content Area */}
          <div className="flex-1 min-w-0">
            {/* ===================== GENERAL TAB ===================== */}
            {activeProfileTabSafe === "general" && (
              <ProfileGeneralTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
                discardKey={discardKey}
                onAvatarCrop={handleCroppedAvatar}
                onSetCropDialog={(open, src) => {
                  setCropDialogOpen(open);
                  setCropImageSrc(src);
                }}
              />
            )}

            {/* ===================== SOCIAL TAB ===================== */}
            {activeProfileTabSafe === "social" && (
              <ProfileSocialTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
              />
            )}

            {/* ===================== BILLING TAB ===================== */}
            {activeProfileTabSafe === "billing" && (
              <ProfileBillingTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
                preloadedBillingInfo={billingInfo}
              />
            )}

            {/* ===================== SECURITY TAB ===================== */}
            {activeProfileTabSafe === "security" && (
              <ProfileSecurityTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
              />
            )}

            {/* ===================== DEVELOPER TAB ===================== */}
            {activeProfileTabSafe === "developer" && (
              <ProfileDeveloperTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
                preloadedApiKeys={apiKeys}
                preloadedWebhooks={webhooks}
                preloadedSchedules={schedules}
                setApiKeys={setApiKeys}
                setWebhooks={setWebhooks}
                setSchedules={setSchedules}
              />
            )}

            {/* ===================== NOTIFICATIONS TAB ===================== */}
            {activeProfileTabSafe === "notifications" && (
              <ProfileNotificationsTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
                discardKey={discardKey}
                saveKey={saveKey}
                preloadedNotifPrefs={notifPrefs}
              />
            )}

            {/* ===================== PRIVACY TAB ===================== */}
            {activeProfileTabSafe === "privacy" && (
              <ProfilePrivacyTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
                discardKey={discardKey}
                saveKey={saveKey}
                preloadedDataReqInfo={dataReqInfo}
                preloadedScansPrivateByDefault={scansPrivateByDefault}
                preloadedSharePubliclyListedByDefault={
                  sharePubliclyListedByDefault
                }
              />
            )}

            {/* ===================== AI SETTINGS TAB ===================== */}
            {activeProfileTabSafe === "ai" && (
              <ProfileAiSettingsTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
              />
            )}
          </div>
          {/* End Main Content Area */}
        </div>
        {/* End Two-column layout */}

        {/* Bottom spacer for floating save bar */}
        {hasPendingChanges && <div className="h-20" />}
      </main>

      {/* Floating Save Bar */}
      {hasPendingChanges && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none"
          role="status"
        >
          <div className="max-w-lg mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-card border border-border shadow-lg">
              <div className="flex items-center gap-3">
                <Save className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">
                  {pendingChangeItems.length} unsaved change
                  {pendingChangeItems.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={discardAllChanges}>
                  Discard
                </Button>
                <Button size="sm" onClick={() => setShowSaveModal(true)}>
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async () => {
          await saveAllPendingChanges();
        }}
        title="Save Changes"
        description="Review your pending changes before saving."
        changes={pendingChangeItems}
        loading={savingProfile}
        isAdminAction={false}
        confirmText="Save All Changes"
      />

      <Footer />

      <ImageCropDialog
        open={cropDialogOpen}
        imageSrc={cropImageSrc}
        onClose={() => {
          setCropDialogOpen(false);
          setCropImageSrc(null);
        }}
        onCrop={handleCroppedAvatar}
        saving={uploadingAvatar}
      />
    </div>
  );
}
