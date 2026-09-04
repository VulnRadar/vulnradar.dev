"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { cn } from "@/lib/ui/utils";
import { tourAnchor } from "@/lib/tour/anchors";
import { API } from "@/lib/config/client-constants";
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
import { AppPageShell } from "@/components/shared/app-page-shell";
import { ProfileDataSkeleton } from "@/components/profile/profile-skeleton";
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

  // admin: always reflect the current tab in the URL, even on first
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

  // Change tab: just update the query param, no page reload
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
  // A 401/403 sends the user to /login, and the redirect is not instant, so
  // this keeps the skeleton up in the meantime rather than flashing the
  // "could not be loaded" screen at someone who is simply signed out.
  const [redirectingToLogin, setRedirectingToLogin] = useState(false);
  // Separate from `error` because `error` auto-clears after 8 seconds. This
  // one describes a page that never loaded at all, so it has to persist.
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Stable patcher so a tab (e.g. Security's 2FA toggle) can keep this local
  // `user` current; without it a tab's change reverts on the next tab switch.
  const patchUser = useCallback(
    (patch: Partial<ProfileUser>) =>
      setUser((u) => (u ? { ...u, ...patch } : u)),
    [],
  );

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
        // Fallback string, matching every other save path in this file. A
        // non-2xx body without an `error` key set this to undefined, which
        // made the banner condition below falsy, so the upload failed with
        // no message at all and the crop dialog stayed open as if nothing
        // had happened.
        setError(data.error || "Failed to upload profile picture.");
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
  const [digestEmailEnabled, setDigestEmailEnabled] = useState<boolean | null>(
    null,
  );

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the OAuth redirect's URL query params (an external system) to seed a one-time success message
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
        postureDigestRes,
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
        fetch(API.ACCOUNT_POSTURE_DIGEST),
      ]);

      // Only an actual auth failure means "you are signed out". A 500 or a
      // gateway error on /auth/me used to bounce a perfectly valid session to
      // the login screen, which reads as the session having been dropped;
      // anything that is not 401/403 gets an error state instead.
      if (!userRes.ok) {
        if (userRes.status === 401 || userRes.status === 403) {
          setRedirectingToLogin(true);
          router.push("/login");
          return;
        }
        setLoadFailed(
          "The server did not return your account. You are still signed in, so this is a problem on our side.",
        );
        return;
      }

      const userData = await userRes.json();
      setUser(userData);

      // Parse developer tab data.
      //
      // Each of these substitutes an empty collection when its request fails,
      // which renders identically to genuinely having none. On this page that
      // is actively misleading: a user whose keys request failed sees "no API
      // keys" and may reasonably conclude theirs were revoked, or create a
      // duplicate. Empty and failed have to look different, so track which
      // ones failed and say so.
      const failedSections: string[] = [];
      if (!keysRes.ok) failedSections.push("API keys");
      if (!webhooksRes.ok) failedSections.push("webhooks");
      if (!schedulesRes.ok) failedSections.push("scheduled scans");
      // The two privacy defaults matter more than the rest: their fallbacks
      // render as "scans are public by default", so a failed request could
      // tell someone their scans are public when they are not, or the
      // reverse. A privacy control must never display a guess.
      if (!privacyRes.ok) failedSections.push("scan privacy default");
      if (!sharePrivacyRes.ok) failedSections.push("public listing default");
      // The same rule for the three below, each of which used to fail
      // silently into something that reads as a settled answer: the twenty
      // notification switches fell back to every category ON (so someone who
      // had unsubscribed from product email was shown as subscribed), the
      // posture-digest opt-in fell back to OFF, and Billing fell back to a
      // skeleton that never resolves on the tab that charges people money.
      // The tabs now render those as unknown; this is what announces why.
      if (!notifsRes.ok) failedSections.push("email notification settings");
      if (!postureDigestRes.ok) failedSections.push("posture digest setting");
      if (!billingRes.ok) failedSections.push("billing details");
      if (failedSections.length > 0) {
        setError(
          `Could not load your ${failedSections.join(", ")}. Those sections may look empty, and any setting we could not read is shown as unknown rather than guessed. Reload to try again.`,
        );
      }

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

      // Parse the account-level posture-digest opt-in
      if (postureDigestRes.ok) {
        const postureDigestData = await postureDigestRes.json();
        setDigestEmailEnabled(Boolean(postureDigestData.digestEmailEnabled));
      }
    } catch {
      setLoadFailed("Could not reach the server to load your account.");
    } finally {
      setLoading(false);
    }
  }, [router, setLoadFailed, setLoading]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
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

  // Sticky keeps the banner on screen once it has been scrolled past, but a
  // failure raised while the user is far below it still needs the page to
  // come back to it. "nearest" is deliberate: if it is already visible this
  // is a no-op.
  const statusBannerRef = React.useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!error) return;
    statusBannerRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [error]);

  // ---- Account handlers ----
  // Data request and delete handlers are now managed in ProfilePrivacyTab component

  // Unified save all changes
  async function saveAllPendingChanges(): Promise<{
    ok: boolean;
    error?: string;
  }> {
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
        const data = await res.json();
        if (res.ok) {
          setUser((u) => (u ? { ...u, name: data.name } : u));
        } else {
          const message = data.error || "Failed to update your name.";
          setError(message);
          return { ok: false, error: message };
        }
      }

      // Save email if changed
      if (pendingChanges.email !== undefined) {
        const res = await fetch(API.AUTH.UPDATE, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: pendingChanges.email }),
        });
        const data = await res.json();
        if (res.ok) {
          setUser((u) => (u ? { ...u, email: data.email } : u));
        } else {
          const message = data.error || "Failed to update your email.";
          setError(message);
          return { ok: false, error: message };
        }
      }

      // Save notification preferences if changed
      if (pendingChanges.notifications) {
        const res = await fetch(API.ACCOUNT_NOTIFICATIONS, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pendingChanges.notifications),
        });
        if (!res.ok) {
          const message = "Failed to update notification preferences.";
          setError(message);
          return { ok: false, error: message };
        }
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
        } else {
          const message = "Failed to update scan privacy default.";
          setError(message);
          return { ok: false, error: message };
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
        } else {
          const message =
            "Failed to update Public Scans directory listing default.";
          setError(message);
          return { ok: false, error: message };
        }
      }

      // Save the account-level posture-digest opt-in, if changed
      if (pendingChanges.digestEmailEnabled !== undefined) {
        const res = await fetch(API.ACCOUNT_POSTURE_DIGEST, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            digestEmailEnabled: pendingChanges.digestEmailEnabled,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setDigestEmailEnabled(Boolean(data.digestEmailEnabled));
        } else {
          const message = "Failed to update posture digest setting.";
          setError(message);
          return { ok: false, error: message };
        }
      }

      // Every branch above updates only this page's own local state
      // (setUser, setScansPrivateByDefault, ...) -- none of them touch the
      // app-wide useAuth() SWR cache for /api/v3/auth/me, which is what
      // app/dashboard/page.tsx (and the nav, and everything else reading
      // useAuth().me) actually reads from. That cache dedupes for
      // AUTH_CACHE_DEDUPE_MS (components/providers/auth-provider.tsx) and
      // never revalidates on focus, so without this, a just-saved change
      // (e.g. "scans are private by default", which seeds the dashboard
      // scan form's "Keep this scan private" toggle) stayed invisible to
      // every other page for that whole window after saving, reading as
      // "the toggle doesn't even seem to be on."
      refreshAuthCache();

      setPendingChanges({});
      setShowSaveModal(false);
      setSaveKey((prev) => prev + 1); // Trigger child components to update their original values
      setSuccess(`Changes saved successfully.`);
      return { ok: true };
    } catch {
      const message = "Failed to save some changes.";
      setError(message);
      return { ok: false, error: message };
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
      ? Object.entries(pendingChanges.notifications as Record<string, boolean>)
          // The Posture Digest switch writes two columns (users.digest_email_enabled
          // and notification_preferences.email_posture_digest, see the Notifications
          // tab), so without this the review modal listed the same change twice.
          .filter(([key]) => key !== "email_posture_digest")
          .map(([key, value]) => ({
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
    ...(pendingChanges.digestEmailEnabled !== undefined
      ? [
          {
            field: "digestEmailEnabled",
            label: "Posture Digest",
            oldValue: pendingChanges.digestEmailEnabled
              ? "Disabled"
              : "Enabled",
            newValue: pendingChanges.digestEmailEnabled
              ? "Enabled"
              : "Disabled",
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

  // A 401/403 is already on its way to /login, so it keeps the panel greyed
  // rather than flashing the "could not be loaded" screen at someone who is
  // simply signed out.
  const showSkeleton = loading || redirectingToLogin;

  // Loading finished but the account never arrived: a 5xx or a network fault
  // on /auth/me. Every tab below reads `user`, so rendering them against null
  // would show a settings page full of blanks. Say what happened instead, and
  // give the one action that can fix it. This one branch does replace the
  // page: with no account there is no sidebar worth keeping mounted.
  if (!user && !showSkeleton) {
    return (
      <AppPageShell
        maxWidth="max-w-5xl"
        padding="py-8 sm:py-10"
        className="lg:px-8 flex flex-col items-center justify-center gap-4 text-center"
      >
        <AlertTriangle
          className="h-6 w-6 text-destructive"
          aria-hidden="true"
        />
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
          Account settings could not be loaded
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {loadFailed ||
            "The server did not return your account. You are still signed in."}
        </p>
        <Button
          variant="outline"
          className="bg-transparent"
          onClick={() => {
            setLoading(true);
            setLoadFailed(null);
            fetchData();
          }}
        >
          Try again
        </Button>
      </AppPageShell>
    );
  }

  // Eight panels behind eight flat entries told you nothing about which one
  // holds what you came for, so finding a setting meant opening tabs until it
  // appeared. The three groups are the three reasons anyone is on this page:
  // the account itself, the things you build against it, and the switches
  // that change what the product does to you. The mobile strip stays flat,
  // because it already scrolls and group labels in a horizontal row would
  // just be more to scroll past.
  const TAB_GROUPS: {
    label: string;
    tabs: { id: ProfileTab; label: string; icon: React.ReactNode }[];
  }[] = [
    {
      label: "Account",
      tabs: [
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
      ],
    },
    {
      label: "Build with it",
      tabs: [
        {
          id: "developer" as ProfileTab,
          label: "Developer",
          icon: <Key className="h-4 w-4" />,
        },
        {
          id: "ai" as ProfileTab,
          label: "AI",
          icon: <Bot className="h-4 w-4" />,
        },
      ],
    },
    {
      label: "Preferences",
      tabs: [
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
      ],
    },
  ];
  const TABS = TAB_GROUPS.flatMap((g) => g.tabs);

  return (
    <AppPageShell
      maxWidth="max-w-5xl"
      padding="py-8 sm:py-10"
      className="lg:px-8 flex flex-col gap-6 sm:gap-8"
    >
      {/* Page header, top-left pattern (matches Admin / Shared pages). The
            H1 is the Tier B in-app scale shared with History, Assets, Shares,
            Repos and Public scans, so the title does not change size as the
            user moves between them. */}
      <div className="mb-2">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
          Account Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account settings and preferences
        </p>
      </div>

      {/* Status banner. Every tab writes its success/error here, and the
            tabs are long: the Developer tab alone stacks API keys, webhooks
            and schedules vertically, so a failed delete near its bottom used
            to set a message hundreds of pixels above the viewport and the
            click read as having done nothing. Sticky below the fixed header
            (which itself shifts down by --vr-banner-h and --vr-imp-banner-h
            when a site notice or the impersonation banner is up, the same
            offset the desktop sidebar uses), plus a scroll-into-view
            on the first render of an error, so the message is always where
            the user is looking. */}
      {(error || success) && (
        <div
          ref={statusBannerRef}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
          className={cn(
            "sticky top-[calc(4.5rem+var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] z-30 flex items-center gap-3 px-4 py-3 rounded-xl text-sm border backdrop-blur-sm transition-[top] duration-300",
            error
              ? "bg-destructive/10 text-destructive border-destructive/20"
              : "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
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
            className="text-xs font-medium hover:underline opacity-70 hover:opacity-100 transition-opacity rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Two-column layout: Sidebar + Content */}
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
        {/* Sidebar Navigation */}
        {/* One anchor covering both tab renderings. The tour resolves an
              anchor to the first copy with a real box, and only one of the
              mobile strip and the desktop sidebar is ever laid out, so a step
              that says "open the Developer section" points at whichever of
              them the reader can actually see. */}
        <aside {...tourAnchor("profileTabs")} className="lg:w-48 lg:shrink-0">
          {/* Mobile: Scrollable horizontal tab bar.
                The label used to be `hidden sm:inline`, which below 640px
                left eight buttons holding nothing but a lucide glyph. lucide
                marks its SVG aria-hidden whenever no a11y prop is passed, so
                each button had no accessible name at all and a screen reader
                announced "button" eight times with nothing to tell them
                apart. The row already scrolls horizontally, so width was
                never the constraint that justified hiding the labels: they
                stay at every width now. type="button" keeps these out of any
                enclosing form's submit path and aria-current names the one
                that is showing. */}
          <div className="lg:hidden scroll-x-only scrollbar-hide -mx-4 px-4 border-b border-border/80">
            <div className="flex gap-0.5 min-w-max">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleProfileTabChange(tab.id)}
                  aria-current={
                    activeProfileTabSafe === tab.id ? "page" : undefined
                  }
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px",
                    activeProfileTabSafe === tab.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Desktop: Vertical sidebar. self-start is required for sticky to work in a flex row.
                top offset grows by --vr-banner-h (site-notifications.tsx) and
                --vr-imp-banner-h (admin/impersonation-banner.tsx) when either banner is
                showing, since the fixed Header above shifts down to stay below them too. */}
          <nav
            aria-label="Account settings sections"
            className="hidden lg:flex flex-col gap-5 sticky top-[calc(5rem+var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] self-start transition-[top] duration-300"
          >
            {TAB_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-0.5">
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {group.label}
                </p>
                {group.tabs.map((tab) => (
                  <a
                    key={tab.id}
                    href={`/profile?tab=${tab.id}`}
                    onClick={(e) => {
                      if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        handleProfileTabChange(tab.id);
                      }
                    }}
                    // a11y (SC 4.1.2): the mobile tab list already marks the
                    // active entry; the desktop sidebar carried the state in
                    // colour and weight only.
                    aria-current={
                      activeProfileTabSafe === tab.id ? "page" : undefined
                    }
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
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content Area. The sidebar above is static, so only this
              column waits: `!user` here is unreachable once showSkeleton is
              false (the branch above returns), and is written out so the tabs
              below narrow to a non-null account. */}
        <div {...tourAnchor("profilePanel")} className="flex-1 min-w-0">
          {showSkeleton || !user ? (
            <ProfileDataSkeleton />
          ) : (
            <>
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
                  // Lets a disconnect update this page's `user` in place
                  // instead of reloading the document, which used to throw
                  // away the success banner it had just set.
                  onUserPatch={patchUser}
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
                  onUserPatch={patchUser}
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
                  preloadedDigestEmailEnabled={digestEmailEnabled}
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
            </>
          )}
        </div>
        {/* End Main Content Area */}
      </div>
      {/* End Two-column layout */}

      {/* Bottom spacer for the floating save bar, plus the cookie notice
            underneath it when that is showing. */}
      {hasPendingChanges && (
        <div className="h-[calc(5rem+var(--vr-cookie-h,0px))]" />
      )}

      {/* Floating Save Bar. Fixed-position, so it is not a flex item of the
          shell's main and the column gap above never sees it. */}
      {hasPendingChanges && (
        <div
          // Sits above the cookie notice rather than under it. That bar is
          // z-60 and mounted last in the root layout, so at bottom-0 it
          // covered this one completely: on a phone it is roughly 125px tall
          // and Save/Discard were unreachable until it was dismissed.
          // components/shared/cookie-notice.tsx publishes its real height as
          // --vr-cookie-h for exactly this.
          className="fixed bottom-(--vr-cookie-h,0px) left-0 right-0 z-50 p-4 pointer-events-none transition-[bottom] duration-300"
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
          return await saveAllPendingChanges();
        }}
        title="Save Changes"
        description="Review your pending changes before saving."
        changes={pendingChangeItems}
        loading={savingProfile}
        isAdminAction={false}
        confirmText="Save All Changes"
      />

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
    </AppPageShell>
  );
}
