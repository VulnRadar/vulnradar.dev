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
      role="status"
      aria-live="polite"
      className={cn(
        // max-w keeps a long server error message on screen: without it the
        // part an admin needs to read ran off the right edge on a phone.
        // bottom offsets by --vr-cookie-h (components/shared/cookie-notice.tsx)
        // so a toast is not published underneath the z-60 cookie bar, which is
        // roughly 125px tall on a phone.
        "fixed bottom-[calc(1rem+var(--vr-cookie-h,0px))] right-4 z-50 flex items-center gap-2.5 rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-bottom-2",
        "max-w-[calc(100vw-2rem)] sm:max-w-sm",
        toast.type === "success"
          ? "bg-[hsl(var(--success))]/10 border-[hsl(var(--success))]/30 text-[hsl(var(--success))]"
          : "bg-destructive/10 border-destructive/30 text-destructive",
      )}
    >
      {toast.type === "success" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="text-sm font-medium min-w-0 wrap-break-word">
        {toast.message}
      </span>
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        className={cn(
          "ml-2 opacity-60 hover:opacity-100 transition-opacity rounded-sm",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
