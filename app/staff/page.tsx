"use client"

import { useEffect, useState } from "react"
import { Shield, ShieldCheck, Headset, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { APP_NAME, STAFF_ROLE_LABELS } from "@/lib/constants"

interface StaffMember {
  name: string
  role: string
  avatarUrl: string | null
}

const ROLE_CONFIG: Record<string, { icon: typeof Shield; color: string; bg: string; border: string; glow: string }> = {
  admin: {
    icon: ShieldCheck,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    glow: "shadow-red-500/5",
  },
  moderator: {
    icon: Shield,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    glow: "shadow-amber-500/5",
  },
  support: {
    icon: Headset,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    glow: "shadow-blue-500/5",
  },
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/staff")
      .then((r) => r.json())
      .then((d) => setStaff(d.staff || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const grouped = {
    admin: staff.filter((s) => s.role === "admin"),
    moderator: staff.filter((s) => s.role === "moderator"),
    support: staff.filter((s) => s.role === "support"),
  }

  return (
    <>
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-5 border border-primary/20">
          <Users className="h-3.5 w-3.5" />
          Meet the Team
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4 text-balance">
          {APP_NAME} Staff
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed text-pretty">
          The dedicated team behind {APP_NAME} who build, maintain, and support the platform every day.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!loading && staff.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <Users className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground">No staff members to display.</p>
        </div>
      )}

      {/* Staff sections by role */}
      {!loading && staff.length > 0 && (
        <div className="flex flex-col gap-10">
          {(["admin", "moderator", "support"] as const).map((roleKey) => {
            const members = grouped[roleKey]
            if (members.length === 0) return null
            const config = ROLE_CONFIG[roleKey]
            const RoleIcon = config.icon

            return (
              <section key={roleKey}>
                {/* Section header */}
                <div className="flex items-center gap-3 mb-5">
                  <div className={cn("flex items-center justify-center h-8 w-8 rounded-lg", config.bg)}>
                    <RoleIcon className={cn("h-4 w-4", config.color)} />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {roleKey === "admin" ? "Administrators" : roleKey === "moderator" ? "Moderators" : "Support Team"}
                    </h2>
                    <p className="text-[11px] text-muted-foreground">
                      {roleKey === "admin"
                        ? "Full platform access and management"
                        : roleKey === "moderator"
                          ? "User moderation and enforcement"
                          : "Help and customer assistance"}
                    </p>
                  </div>
                  <span className={cn("ml-auto text-xs font-medium px-2 py-0.5 rounded-full", config.bg, config.color)}>
                    {members.length}
                  </span>
                </div>

                {/* Member cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {members.map((member, i) => {
                    const initials = getInitials(member.name)

                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center gap-4 rounded-xl border p-4 bg-card transition-all hover:shadow-lg",
                          config.border,
                          config.glow,
                        )}
                      >
                        {/* Avatar */}
                        <div
                          className={cn(
                            "relative flex items-center justify-center w-12 h-12 rounded-full shrink-0 overflow-hidden ring-2",
                            config.bg,
                            member.avatarUrl ? "ring-border" : `ring-transparent`,
                          )}
                        >
                          {member.avatarUrl ? (
                            <img src={member.avatarUrl} alt={member.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className={cn("text-sm font-bold", config.color)}>
                              {initials}
                            </span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex flex-col gap-1 min-w-0">
                          <h3 className="text-sm font-semibold text-foreground truncate">
                            {member.name}
                          </h3>
                          <div className={cn("inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-[10px] font-medium", config.bg, config.color)}>
                            <RoleIcon className="h-2.5 w-2.5" />
                            {STAFF_ROLE_LABELS[member.role] || member.role}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Footer note */}
      {!loading && staff.length > 0 && (
        <div className="mt-12 text-center">
          <p className="text-xs text-muted-foreground/60">
            Need help? Our staff team is here to assist you.
          </p>
        </div>
      )}
    </>
  )
}
