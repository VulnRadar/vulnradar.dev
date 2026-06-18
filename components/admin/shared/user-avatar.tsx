import Image from "next/image"
import { cn } from "@/lib/ui/utils"
import { AVATAR_COLORS, getAvatarColorIndex } from "../utils"

interface UserAvatarProps {
  name: string | null
  email: string
  size?: "sm" | "md" | "lg"
  avatarUrl?: string | null
}

/**
 * User avatar component with fallback to initials
 */
export function UserAvatar({ name, email, size = "md", avatarUrl }: UserAvatarProps) {
  const initial = (name || email).charAt(0).toUpperCase()
  const colorIdx = getAvatarColorIndex(email)
  
  const sizeClasses = {
    sm: "h-7 w-7 text-[10px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  }
  
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name || email}
        width={48}
        height={48}
        loading="lazy"
        className={cn("rounded-full object-cover shrink-0", sizeClasses[size])}
      />
    )
  }
  
  return (
    <div className={cn(
      "rounded-full flex items-center justify-center font-bold shrink-0", 
      sizeClasses[size], 
      AVATAR_COLORS[colorIdx]
    )}>
      {initial}
    </div>
  )
}
