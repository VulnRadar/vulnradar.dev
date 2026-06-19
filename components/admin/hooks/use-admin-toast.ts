"use client";

import { useState, useCallback } from "react";
import type { ToastState } from "../types";

/**
 * Global admin toast controller hook
 * Provides consistent toast notifications across the admin panel
 */
export function useAdminToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
    },
    [],
  );

  const success = useCallback(
    (message: string) => {
      showToast(message, "success");
    },
    [showToast],
  );

  const error = useCallback(
    (message: string) => {
      showToast(message, "error");
    },
    [showToast],
  );

  const dismiss = useCallback(() => {
    setToast(null);
  }, []);

  return {
    toast,
    showToast,
    success,
    error,
    dismiss,
  };
}

export type AdminToastController = ReturnType<typeof useAdminToast>;
