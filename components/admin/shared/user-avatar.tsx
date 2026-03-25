"use client"

import { cn } from "@/lib/utils"

interface UserAvatarProps {
  name: string | null
  email: string
  size?: "sm" | "md" | "lg"
  avatarUrl?: string | null
}

export function UserAvatar({ name, email, size = "md", avatarUrl }: UserAvatarProps) {
  const initial = (name || email).charAt(0).toUpperCase()
  const colors = [
    "bg-primary/15 text-primary",
    "bg-emerald-500/15 text-emerald-500",
    "bg-[hsl(var(--severity-medium))]/15 text-[hsl(var(--severity-medium))]",
    "bg-[hsl(var(--severity-high))]/15 text-[hsl(var(--severity-high))]",
    "bg-[hsl(var(--severity-low))]/15 text-[hsl(var(--severity-low))]",
  ]
  const colorIdx = email.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length
  
  const sizeClasses = {
    sm: "h-7 w-7 text-[10px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  }
  
  if (avatarUrl) {
    return (
      <img 
        src={avatarUrl} 
        alt={name || email} 
        loading="lazy" 
        className={cn("rounded-full object-cover shrink-0", sizeClasses[size])} 
      />
    )
  }
  
  return (
    <div className={cn(
      "rounded-full flex items-center justify-center font-bold shrink-0", 
      sizeClasses[size], 
      colors[colorIdx]
    )}>
      {initial}
    </div>
  )
}
