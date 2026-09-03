import { Eye } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { ROLE_ICONS, ROLE_COLORS } from "./teams-types";

/**
 * One role badge, used everywhere a team role is shown: the teams list, the
 * members list, and the pending-invitation rows. It was hand-copied in all
 * three, which is how the invitation rows ended up without the role icon the
 * other two carry, and why a role added to ROLE_ICONS only appeared in two of
 * the three places. `sm` is for the tighter rows inside a sentence.
 */
export function RolePill({
  role,
  size = "md",
  className,
}: {
  role: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = ROLE_ICONS[role] || Eye;
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border font-medium capitalize",
        size === "sm"
          ? "gap-1 px-1.5 py-0.5 text-[11px]"
          : "gap-1.5 px-2.5 py-1 text-xs",
        ROLE_COLORS[role],
        className,
      )}
    >
      <Icon
        className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"}
        aria-hidden="true"
      />
      {role}
    </span>
  );
}
