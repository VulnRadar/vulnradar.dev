"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Shield, Headset, Users } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import {
  APP_NAME,
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  API,
} from "@/lib/config/constants";
import { Skeleton } from "@/components/admin/shared";

// Staff roles that should appear on the staff page (excluding regular users and badge-only roles)
const DISPLAY_STAFF_ROLES = [
  STAFF_ROLES.ADMIN,
  STAFF_ROLES.MODERATOR,
  STAFF_ROLES.SUPPORT,
] as const;

interface StaffMember {
  displayName: string;
  role: string;
}

// Icon per staff role. Colors come from the shared ROLE_BADGE_STYLES
// constant (lib/config/client-constants.ts) so a role reads the same way
// here as it does in the admin panel.
const ROLE_ICONS: Record<string, typeof Shield> = {
  admin: ShieldCheck,
  moderator: Shield,
  support: Headset,
  // Note: beta_tester is now a badge, not a staff role shown on staff page
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(API.STAFF)
      .then((r) => r.json())
      .then((d) => setStaff(d.staff || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Only group actual staff roles (admin, moderator, support)
  // beta_tester is a badge now, not shown on staff page
  const grouped = {
    [STAFF_ROLES.ADMIN]: staff.filter((s) => s.role === STAFF_ROLES.ADMIN),
    [STAFF_ROLES.MODERATOR]: staff.filter(
      (s) => s.role === STAFF_ROLES.MODERATOR,
    ),
    [STAFF_ROLES.SUPPORT]: staff.filter((s) => s.role === STAFF_ROLES.SUPPORT),
  };

  return (
    <>
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-5 border border-primary/20">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          Meet the Team
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4 text-balance">
          {APP_NAME} Staff
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed text-pretty">
          The dedicated team behind {APP_NAME} who build, maintain, and support
          the platform every day.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div
          className="flex flex-col gap-10"
          aria-busy="true"
          aria-label="Loading staff"
        >
          {[1, 2].map((section) => (
            <div key={section}>
              <div className="flex items-center gap-3 mb-5">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-40" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3].map((card) => (
                  <div
                    key={card}
                    className="flex items-center gap-4 rounded-xl border border-border/50 p-4 bg-card"
                  >
                    <Skeleton className="h-12 w-12 rounded-full shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && staff.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <Users
              className="h-7 w-7 text-muted-foreground/40"
              aria-hidden="true"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            No staff members to display.
          </p>
        </div>
      )}

      {/* Staff sections by role */}
      {!loading && staff.length > 0 && (
        <div className="flex flex-col gap-10">
          {DISPLAY_STAFF_ROLES.map((roleKey) => {
            const members = grouped[roleKey];
            if (members.length === 0) return null;
            const RoleIcon = ROLE_ICONS[roleKey] || Shield;
            const roleStyle =
              ROLE_BADGE_STYLES[roleKey] || ROLE_BADGE_STYLES.user;

            const SECTION_TITLES: Record<string, string> = {
              [STAFF_ROLES.ADMIN]: "Administrators",
              [STAFF_ROLES.MODERATOR]: "Moderators",
              [STAFF_ROLES.SUPPORT]: "Support Team",
            };
            const SECTION_DESCS: Record<string, string> = {
              [STAFF_ROLES.ADMIN]: "Full platform access and management",
              [STAFF_ROLES.MODERATOR]: "User moderation and enforcement",
              [STAFF_ROLES.SUPPORT]: "Help and customer assistance",
            };

            return (
              <section key={roleKey}>
                {/* Section header */}
                <div className="flex items-center gap-3 mb-5">
                  <div
                    className={cn(
                      "flex items-center justify-center h-8 w-8 rounded-lg border",
                      roleStyle,
                    )}
                  >
                    <RoleIcon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {SECTION_TITLES[roleKey] ||
                        STAFF_ROLE_LABELS[roleKey] ||
                        roleKey}
                    </h2>
                    <p className="text-[11px] text-muted-foreground">
                      {SECTION_DESCS[roleKey] || ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "ml-auto text-xs font-medium px-2 py-0.5 rounded-full border",
                      roleStyle,
                    )}
                  >
                    {members.length}
                  </span>
                </div>

                {/* Member cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {members.map((member, i) => {
                    const initials = getInitials(member.displayName);

                    return (
                      <div
                        key={i}
                        className="flex items-center gap-4 rounded-xl border border-border/50 p-4 bg-card transition-shadow hover:shadow-md"
                      >
                        {/* Initials badge (avatar URL no longer exposed by /api/v3/staff) */}
                        <div
                          className={cn(
                            "relative flex items-center justify-center w-12 h-12 rounded-full shrink-0 overflow-hidden ring-2 ring-border border",
                            roleStyle,
                          )}
                        >
                          <span className="text-sm font-bold">{initials}</span>
                        </div>

                        {/* Info */}
                        <div className="flex flex-col gap-1 min-w-0">
                          <h3 className="text-sm font-semibold text-foreground truncate">
                            {member.displayName}
                          </h3>
                          <div
                            className={cn(
                              "inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-[10px] font-medium border",
                              roleStyle,
                            )}
                          >
                            <RoleIcon
                              className="h-2.5 w-2.5"
                              aria-hidden="true"
                            />
                            {STAFF_ROLE_LABELS[member.role] || member.role}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
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
  );
}
