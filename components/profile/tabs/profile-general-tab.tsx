"use client";

import React, { useState, useRef } from "react";
import { LanguageSelect } from "@/components/shared/language-select";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  UserCog,
  Award,
  Mail,
  Pencil,
  Camera,
  Loader2,
  Tag,
  Radar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  API,
  APP_REPO,
  ROUTES,
  MAX_AVATAR_UPLOAD_BYTES,
} from "@/lib/config/client-constants";
import { refreshAuthCache } from "@/components/providers/auth-provider";
import type { ProfileTabProps, ProfileUser } from "../types";
import { useConfirm } from "@/components/shared/use-confirm";
import { EditDialog } from "@/components/shared/edit-dialog";

interface ProfileGeneralTabProps extends ProfileTabProps {
  onAvatarCrop?: (croppedDataUrl: string) => void;
  onSetCropDialog?: (open: boolean, imageSrc: string | null) => void;
}

type DetailsUser = Pick<ProfileUser, "name" | "email" | "hasPassword">;

/**
 * What ProfileDetailsDialog holds while it is open. The current password is
 * here, in the dialog's own state, and nowhere else: it used to sit in the
 * page-wide pendingChanges, where the inline Cancel left it behind.
 */
export interface ProfileDetailsDraft {
  name: string;
  email: string;
  currentPassword: string;
}

export function profileDetailsDraftFrom(
  user: DetailsUser,
): ProfileDetailsDraft {
  return {
    name: user.name || "",
    email: user.email || "",
    currentPassword: "",
  };
}

function nameChanged(draft: ProfileDetailsDraft, user: DetailsUser) {
  return draft.name !== (user.name || "");
}

function emailChanged(draft: ProfileDetailsDraft, user: DetailsUser) {
  return draft.email !== user.email;
}

/**
 * PATCH /auth/update refuses an address change without the current password,
 * except for an OAuth-only account that has none to re-enter.
 */
export function profileDetailsNeedsPassword(
  draft: ProfileDetailsDraft,
  user: DetailsUser,
): boolean {
  return emailChanged(draft, user) && user.hasPassword !== false;
}

/** Putting the address back hides the password field, so it forgets the password too. */
export function withDetailsEmail(
  draft: ProfileDetailsDraft,
  email: string,
  user: DetailsUser,
): ProfileDetailsDraft {
  return {
    ...draft,
    email,
    currentPassword: email === user.email ? "" : draft.currentPassword,
  };
}

export function profileDetailsDirty(
  draft: ProfileDetailsDraft,
  user: DetailsUser,
): boolean {
  return nameChanged(draft, user) || emailChanged(draft, user);
}

export function profileDetailsCanSave(
  draft: ProfileDetailsDraft,
  user: DetailsUser,
): boolean {
  if (!profileDetailsDirty(draft, user)) return false;
  if (emailChanged(draft, user) && draft.email.trim() === "") return false;
  if (profileDetailsNeedsPassword(draft, user) && draft.currentPassword === "")
    return false;
  return true;
}

export type ProfileDetailsSaveResult =
  { ok: true; message: string } | { ok: false; error: string };

async function patchProfile(
  body: Record<string, string>,
  fallback: string,
): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
> {
  try {
    const res = await fetch(API.AUTH.UPDATE, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (res.ok) return { ok: true, data };
    return {
      ok: false,
      error:
        typeof data.error === "string" && data.error ? data.error : fallback,
    };
  } catch {
    return { ok: false, error: fallback };
  }
}

/**
 * The dialog's Save. The name goes first, on its own, because it needs no
 * password and a refused email must not take a good rename down with it;
 * when that happens the message says the name went through, since the
 * dialog stays open showing both fields as typed.
 *
 * The password is sent exactly as typed, never trimmed (a password is
 * whatever its owner set, spaces included), and only in the request body.
 */
export async function saveProfileDetails(
  draft: ProfileDetailsDraft,
  user: DetailsUser,
  onUserPatch?: (patch: Partial<ProfileUser>) => void,
): Promise<ProfileDetailsSaveResult> {
  let nameSaved = false;
  if (nameChanged(draft, user)) {
    const result = await patchProfile(
      { name: draft.name },
      "Failed to update your name.",
    );
    if (!result.ok) return result;
    onUserPatch?.({ name: result.data.name as string | null });
    nameSaved = true;
  }

  let emailSaved = false;
  if (emailChanged(draft, user)) {
    const result = await patchProfile(
      { email: draft.email, currentPassword: draft.currentPassword },
      "Failed to update your email.",
    );
    if (!result.ok) {
      if (nameSaved) refreshAuthCache();
      return {
        ok: false,
        error: nameSaved
          ? `Your name was saved. The email address was not: ${result.error}`
          : result.error,
      };
    }
    onUserPatch?.({ email: result.data.email as string });
    emailSaved = true;
  }

  // name and email are part of MeResponse, so the nav and every other page
  // reading useAuth() need telling, not just this page's own copy.
  refreshAuthCache();
  return {
    ok: true,
    message: emailSaved
      ? "Your email address was updated."
      : "Your name was updated.",
  };
}

export function ProfileDetailsFields({
  draft,
  user,
  onChange,
}: {
  draft: ProfileDetailsDraft;
  user: DetailsUser;
  onChange: (next: ProfileDetailsDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-details-name">Display name</Label>
        <Input
          id="profile-details-name"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Your display name"
          autoComplete="name"
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-details-email">Email address</Label>
        <Input
          id="profile-details-email"
          type="email"
          value={draft.email}
          onChange={(e) =>
            onChange(withDetailsEmail(draft, e.target.value, user))
          }
          placeholder="Your email address"
          autoComplete="email"
          required
        />
      </div>
      {/* The address is the account's recovery route, so changing it is a
          sensitive change and the API requires the current password for one.
          Shown only while the address is actually being changed, and only for
          an account that has a password to re-enter, matching the condition
          the route applies. */}
      {profileDetailsNeedsPassword(draft, user) && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-details-password">Current password</Label>
          <Input
            id="profile-details-password"
            type="password"
            value={draft.currentPassword}
            onChange={(e) =>
              onChange({ ...draft, currentPassword: e.target.value })
            }
            placeholder="Confirm it is you"
            autoComplete="current-password"
          />
          <p className="text-xs text-muted-foreground">
            Required to change the address your account recovers through.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Mounted only while open, so every opening starts from the saved account and
 * a typed password is gone with the dialog the moment it closes.
 */
export function ProfileDetailsDialog({
  user,
  onClose,
  onUserPatch,
  onSaved,
}: {
  user: DetailsUser;
  onClose: () => void;
  onUserPatch?: (patch: Partial<ProfileUser>) => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => profileDetailsDraftFrom(user));
  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Edit personal details"
      description="Your display name and the email address you sign in and recover your account with."
      dirty={profileDetailsDirty(draft, user)}
      canSave={profileDetailsCanSave(draft, user)}
      onSave={async () => {
        const result = await saveProfileDetails(draft, user, onUserPatch);
        if (!result.ok) return result.error;
        onSaved(result.message);
        return null;
      }}
    >
      <ProfileDetailsFields draft={draft} user={user} onChange={setDraft} />
    </EditDialog>
  );
}

export function ProfileGeneralTab({
  user,
  setError,
  setSuccess,
  onTabChange,
  onUserPatch,
  onAvatarCrop,
  onSetCropDialog,
}: ProfileGeneralTabProps) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [editingDetails, setEditingDetails] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [replayingTour, setReplayingTour] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      setError(
        `Image must be under ${Math.floor(MAX_AVATAR_UPLOAD_BYTES / (1024 * 1024))}MB.`,
      );
      return;
    }
    setError(null);
    const isGif = file.type === "image/gif";
    if (isGif) {
      const reader = new FileReader();
      reader.onload = () => onAvatarCrop?.(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => onSetCropDialog?.(true, reader.result as string);
      reader.readAsDataURL(file);
    }
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  async function handleRemoveAvatar() {
    setUploadingAvatar(true);
    setError(null);
    try {
      const res = await fetch(API.AUTH.UPDATE, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: "" }),
      });
      const data = await res.json();
      if (res.ok) {
        // avatarUrl is part of MeResponse -- the app-wide useAuth() cache
        // (nav avatar, etc.) needs telling too, not just this tab's own
        // display, same fix as handleCroppedAvatar in app/profile/page.tsx.
        refreshAuthCache();
        setSuccess("Profile picture removed.");
      } else {
        // Same fallback string as handleCroppedAvatar: a non-2xx body
        // without an `error` key otherwise left this silently doing
        // nothing, and a failed removal looked identical to a successful
        // one that just didn't repaint yet.
        setError(data.error || "Failed to remove profile picture.");
      }
    } catch {
      setError("Failed to remove profile picture.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleReplayTour() {
    setReplayingTour(true);
    setError(null);
    try {
      const res = await fetch(API.AUTH.ONBOARDING, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to restart the product tour.");
        setReplayingTour(false);
        return;
      }
      // onboardingCompleted is part of MeResponse; keep the app-wide
      // useAuth() cache in sync before the dashboard re-checks it and
      // auto-opens the tour on mount.
      refreshAuthCache();
      router.push(ROUTES.DASHBOARD);
    } catch {
      setError("Failed to restart the product tour.");
      setReplayingTour(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Personal Information */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Personal information
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your profile picture, name, and email
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-5">
            {/* Profile Picture */}
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="avatar-upload"
                className="text-sm font-medium text-muted-foreground"
              >
                Profile picture
              </Label>
              <div className="flex items-center gap-4">
                <div className="relative group">
                  <div className="h-16 w-16 rounded-full border-2 border-border bg-secondary/40 flex items-center justify-center overflow-hidden">
                    {user?.avatarUrl ? (
                      <Image
                        src={user.avatarUrl}
                        alt="Profile"
                        width={64}
                        height={64}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xl font-bold text-muted-foreground">
                        {user?.name?.charAt(0)?.toUpperCase() ||
                          user?.email?.charAt(0)?.toUpperCase() ||
                          "?"}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    aria-label="Change profile picture"
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {uploadingAvatar ? (
                      <Loader2
                        className="h-5 w-5 animate-spin text-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <Camera
                        className="h-5 w-5 text-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-transparent text-xs"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                    >
                      {uploadingAvatar ? "Uploading..." : "Upload"}
                    </Button>
                    {user?.avatarUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-destructive hover:text-destructive"
                        onClick={() =>
                          confirm({
                            title: "Remove your profile picture?",
                            description:
                              "Your picture goes back to the default initials. We do not keep a copy, so putting it back means uploading the file again.",
                            confirmLabel: "Remove picture",
                            danger: true,
                            onConfirm: handleRemoveAvatar,
                          })
                        }
                        disabled={uploadingAvatar}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    JPG, PNG, or GIF. Max{" "}
                    {Math.floor(MAX_AVATAR_UPLOAD_BYTES / (1024 * 1024))}MB.
                  </p>
                </div>
                <input
                  ref={avatarInputRef}
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileSelect}
                  className="hidden"
                />
              </div>
            </div>

            {/* Badges section */}
            {user?.badges && user.badges.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Award className="h-4 w-4" /> Badges
                </Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-border bg-secondary/20">
                  {user.badges.map((badge) => (
                    <div
                      key={badge.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: `${badge.color}15`,
                        borderWidth: 1,
                        borderColor: `${badge.color}40`,
                        color: badge.color || undefined,
                      }}
                      title={badge.description || undefined}
                    >
                      <Tag className="h-3 w-3" />
                      {badge.display_name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Read-only here. Edit opens ProfileDetailsDialog, which saves
                the name and email itself rather than through the save bar. */}
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Personal Details
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                aria-label="Edit name and email"
                onClick={() => setEditingDetails(true)}
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Edit
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 p-3 rounded-lg border bg-muted/20 border-border">
                <div className="flex items-center gap-2 mb-1">
                  <UserCog className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground font-medium">
                    Display Name
                  </span>
                </div>
                <span className="text-sm font-medium text-foreground truncate">
                  {user?.name || (
                    <span className="text-muted-foreground italic">
                      Not set
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-1 p-3 rounded-lg border bg-muted/20 border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground font-medium">
                    Email Address
                  </span>
                </div>
                <span className="text-sm font-mono text-foreground truncate">
                  {user?.email}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Language */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Language
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            The language this account reads the site, its emails and its AI
            answers in
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Applies everywhere: the site, the emails we send you, and the
                answers from the AI assistant. It follows your account to any
                browser you sign in on.
              </p>
              <LanguageSelect className="shrink-0" />
            </div>
            {/* Translation is a thing readers are better at than we are, and
                the files are in the open repo, so the ask belongs where
                somebody has just noticed the problem. */}
            <p className="border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">
              Missing your language, or found a translation that reads wrong?
              The wording lives in{" "}
              <a
                href={`https://github.com/${APP_REPO}/tree/main/lib/i18n/messages`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                lib/i18n/messages
              </a>
              : each language is a folder, a new one is a copy of the{" "}
              <code className="font-mono">en</code> folder, and anything left
              untranslated falls back to English rather than breaking. Send a
              pull request, or{" "}
              <a
                href={ROUTES.CONTACT}
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                tell us
              </a>{" "}
              and we will fix it.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Product tour */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Product tour
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            The guided walkthrough new accounts see on their first visit
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* No step count. This said "the eight-step tour" long after the
                tour stopped being eight slides of prose, which is what a
                number typed into copy about something that grows does. */}
            <p className="text-sm text-muted-foreground">
              Restarts the walkthrough from the beginning on your dashboard. It
              highlights real controls and waits for you, and you can end it
              from any step.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent gap-1.5 shrink-0"
              onClick={handleReplayTour}
              disabled={replayingTour}
            >
              {replayingTour ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Radar className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {replayingTour ? "Starting..." : "Replay product tour"}
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* A quiet pointer to the two settings people go looking for right
          after they land here, styled as text rather than another card grid. */}
      <p className="text-sm text-muted-foreground">
        Looking for something else? Password and two-step verification live
        under{" "}
        <button
          type="button"
          onClick={() => onTabChange("security")}
          className="text-primary hover:underline underline-offset-4 font-medium rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Security
        </button>
        , and your Discord connection is under{" "}
        <button
          type="button"
          onClick={() => onTabChange("social")}
          className="text-primary hover:underline underline-offset-4 font-medium rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Social
        </button>
        .
      </p>
      {confirmDialog}
      {editingDetails && user && (
        <ProfileDetailsDialog
          user={user}
          onClose={() => setEditingDetails(false)}
          onUserPatch={onUserPatch}
          onSaved={(message) => {
            setError(null);
            setSuccess(message);
          }}
        />
      )}
    </div>
  );
}
