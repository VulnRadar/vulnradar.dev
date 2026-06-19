"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/ui/utils";

interface ActionCardProps {
  icon: React.ElementType;
  label: string;
  description: string;
  color: string;
  bg: string;
  variant?: "danger" | "success";
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

/**
 * Support action card button for admin actions
 */
export function ActionCard({
  icon: Icon,
  label,
  description,
  color,
  bg,
  variant,
  disabled,
  loading,
  onClick,
}: ActionCardProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left",
        disabled
          ? "border-border/40 bg-muted/20 opacity-50 cursor-not-allowed"
          : variant === "danger"
            ? "border-destructive/20 bg-card/30 hover:bg-destructive/5 hover:border-destructive/30 cursor-pointer"
            : variant === "success"
              ? "border-emerald-500/20 bg-card/30 hover:bg-emerald-500/5 hover:border-emerald-500/30 cursor-pointer"
              : "border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 cursor-pointer",
      )}
      disabled={disabled || loading}
      onClick={onClick}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
          bg,
        )}
      >
        {loading ? (
          <Loader2 className={cn("h-4 w-4 animate-spin", color)} />
        ) : (
          <Icon className={cn("h-4 w-4", color)} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            variant === "danger"
              ? "text-destructive"
              : variant === "success"
                ? "text-emerald-500"
                : "text-foreground",
          )}
        >
          {label}
        </p>
        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
          {description}
        </p>
      </div>
    </button>
  );
}
