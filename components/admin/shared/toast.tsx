"use client";

import { useEffect } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import type { ToastState } from "../types";

interface ToastProps {
  toast: ToastState;
  onClose: () => void;
  duration?: number;
}

/**
 * Toast notification component for admin panel
 */
export function Toast({ toast, onClose, duration = 5000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-bottom-2",
        toast.type === "success"
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          : "bg-destructive/10 border-destructive/30 text-destructive",
      )}
    >
      {toast.type === "success" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0" />
      )}
      <span className="text-sm font-medium">{toast.message}</span>
      <button
        onClick={onClose}
        className="ml-2 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
