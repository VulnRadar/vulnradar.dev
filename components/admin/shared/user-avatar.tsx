"use client"

import { cn } from "@/lib/utils"

interface UserAvatarProps {
  name: string | null
  email: string
  size?: "xs" | "sm" | "md" | "lg"
  avatarUrl?: string | null
  className?: string
}

const AVATAR_COLORS = [
  "bg-primary/15 text-primary",
  "bg-emerald-500/15 text-emerald-500",
  "bg-[hsl(var(--severity-medium))]/15 text-[hsl(var(--severity-medium))]",
  "bg-[hsl(var(--severity-high))]/15 text-[hsl(var(--severity-high))]",
  "bg-[hsl(var(--severity-low))]/15 text-[hsl(var(--severity-low))]",
]

const SIZE_CLASSES = {
  xs: "h-6 w-6 text-[9px]",
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
}

export function UserAvatar({ name, email, size = "md", avatarUrl, className }: UserAvatarProps) {
  const initial = (name || email).charAt(0).toUpperCase()
  const colorIdx = email.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length
  const sizeClass = SIZE_CLASSES[size]

  if (avatarUrl) {
    return (
      <img 
        src={avatarUrl} 
        alt={name || email} 
        loading="lazy" 
        className={cn("rounded-full object-cover shrink-0", sizeClass, className)} 
      />
    )
  }

  return (
    <div className={cn(
      "rounded-full flex items-center justify-center font-bold shrink-0", 
      sizeClass, 
      AVATAR_COLORS[colorIdx],
      className
    )}>
      {initial}
    </div>
  )
}
