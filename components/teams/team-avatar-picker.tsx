"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageCropDialog } from "@/components/modals/image-crop-dialog";
import { API, MAX_AVATAR_UPLOAD_BYTES } from "@/lib/config/client-constants";
import { TeamAvatar } from "./team-avatar";
import { type Team } from "./teams-types";

const MAX_MB = Math.floor(MAX_AVATAR_UPLOAD_BYTES / (1024 * 1024));

/**
 * Set or clear a team's picture.
 *
 * Deliberately the same three steps the profile picture already uses: pick a
 * file, crop it in ImageCropDialog (which hands back a 256x256 PNG data URL),
 * and PATCH that URL, where lib/uploads/avatar.ts validates it and the bytes go
 * into Postgres. Nothing new was invented for teams; only the endpoint differs.
 *
 * Rendered only for a member who holds "manage_team" -- the caller decides that
 * and the API enforces it, so a hand-built request gains nothing.
 */
export function TeamAvatarPicker({
  team,
  onChange,
  onError,
}: {
  team: Team;
  /** The new /api/v3/teams/avatar/<id> URL, or null when it was cleared. */
  onChange: (avatarUrl: string | null) => void;
  onError: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset first, so picking the SAME file again after an error still fires a
    // change event.
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("Pick an image file for the team picture.");
      return;
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      onError(`That image is too big. Keep it under ${MAX_MB}MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.onerror = () => onError("That image could not be read.");
    reader.readAsDataURL(file);
  }

  async function save(avatarUrl: string) {
    setSaving(true);
    try {
      const res = await fetch(API.TEAMS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, avatarUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(data.error || "That picture could not be saved. Try again.");
        return;
      }
      onChange(data.avatarUrl ?? null);
      setCropSrc(null);
    } catch {
      onError(
        "We could not reach the server, so the picture was not changed. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        {/* The whole 48px avatar is the button, with a camera pip that is
            always visible rather than appearing on hover. The profile picture
            control uses a hover-only overlay and pairs it with a separate
            "Upload" button, which is what makes it reachable on a touch screen;
            there is no room for a second button in this header, and a control
            that only exists on hover is no control at all on a phone. 48px also
            clears the 44px touch target the rest of this page uses. */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={saving}
          aria-label={
            team.avatar_url ? "Change team picture" : "Add a team picture"
          }
          className="relative shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <TeamAvatar
            name={team.name}
            avatarUrl={team.avatar_url}
            size={48}
            className="border border-border"
          />
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground"
          >
            {saving ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Camera className="h-2.5 w-2.5" />
            )}
          </span>
        </button>
        {team.avatar_url && (
          <Button
            variant="ghost"
            size="sm"
            // 44px on touch, the target size the rest of this page uses.
            className="h-11 px-2 text-xs text-destructive hover:text-destructive sm:h-8"
            onClick={() => save("")}
            disabled={saving}
          >
            Remove
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <ImageCropDialog
        open={cropSrc !== null}
        imageSrc={cropSrc}
        saving={saving}
        onClose={() => setCropSrc(null)}
        onCrop={save}
      />
    </>
  );
}
