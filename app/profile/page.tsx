"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { cn } from "@/lib/ui/utils";
import { API } from "@/lib/config/constants";
import { useQueryParam } from "@/lib/ui/url-state";

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
  Loader2,
  Bell,
  Share2,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
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
    setActiveProfileTabRaw(tab);
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
      ] = await Promise.all([
        fetch(API.AUTH.ME),
        fetch(API.KEYS),
        fetch(API.WEBHOOKS),
        fetch(API.SCHEDULES),
        fetch(API.ACCOUNT_NOTIFICATIONS),
        fetch(API.BILLING),
        fetch(API.DATA_REQUEST),
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
  ];

  // Discard all pending changes
  function discardAllChanges() {
    setPendingChanges({});
    setDiscardKey((prev) => prev + 1); // Trigger child components to reset
  }

  // ---- Helpers ----

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading profile...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
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
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-6 sm:gap-8 min-w-0">
        {/* Page Header */}
        <section
          aria-label="Settings"
          className="flex flex-col items-center text-center gap-1 pt-2 sm:pt-4"
        >
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Manage your account settings and preferences
          </p>
        </section>

        {/* Toast messages */}
        {(error || success) && (
          <div
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl text-sm border",
              error
                ? "bg-destructive/10 text-destructive border-destructive/20"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
            )}
          >
            {error ? (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            ) : (
              <Check className="h-4 w-4 shrink-0" />
            )}
            <span className="flex-1">{error || success}</span>
            <button
              onClick={() => {
                setError(null);
                setSuccess(null);
              }}
              className="text-xs font-medium hover:underline opacity-70 hover:opacity-100 transition-opacity"
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

            {/* Desktop: Vertical sidebar — self-start is required for sticky to work in a flex row */}
            <nav className="hidden lg:flex flex-col gap-0.5 sticky top-20 self-start">
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
                preloadedDataReqInfo={dataReqInfo}
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
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-card border border-border shadow-lg">
              <div className="flex items-center gap-3">
                <Save className="h-4 w-4 text-primary" />
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
