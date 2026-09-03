import Image from "next/image";
import { cn } from "@/lib/ui/utils";

/**
 * A team's picture, or its initial.
 *
 * One component for both places a team is identified (the list row and the
 * detail header) so the fallback is written once. It matters that there IS a
 * fallback: a team with no picture is the normal case, and an <img> pointed at
 * a URL that 404s renders as a broken-image glyph, which is what a missing
 * avatar used to look like here.
 *
 * `fallbackSrc` is the team owner's own avatar, which is what the list row
 * showed before teams had pictures of their own. Keeping it as the middle rung
 * means turning this on cost no existing row its face.
 */
export function TeamAvatar({
  name,
  avatarUrl,
  fallbackSrc,
  size = 36,
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  fallbackSrc?: string | null;
  size?: number;
  className?: string;
}) {
  const src = avatarUrl || fallbackSrc || null;
  const shared = "shrink-0 rounded-full object-cover";

  if (src) {
    return (
      <Image
        src={src}
        // Decorative: the team name is always written next to it, so an alt
        // repeating it makes a screen reader say the name twice.
        alt=""
        width={size}
        height={size}
        loading="lazy"
        // Not just matching next.config.mjs's global `images.unoptimized`:
        // /api/v3/teams/avatar/[teamId] requires the viewer's session, and the
        // image optimizer fetches on the server without their cookie, so an
        // optimized team picture would come back 401 and render broken.
        unoptimized
        style={{ width: size, height: size }}
        className={cn(shared, className)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size / 2.4) }}
      className={cn(
        shared,
        "flex items-center justify-center bg-muted font-medium text-foreground",
        className,
      )}
    >
      {(name.trim() || "?")[0].toUpperCase()}
    </div>
  );
}
