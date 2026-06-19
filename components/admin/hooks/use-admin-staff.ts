"use client";

import { useState, useCallback } from "react";
import type { ActiveAdmin } from "../types";
import { fetchActiveStaff } from "../services";
import { usePagination } from "@/components/ui/pagination-control";

interface UseAdminStaffOptions {
  initialPageSize?: number;
}

/**
 * Admin staff hook - manages active staff listing
 */
export function useAdminStaff({
  initialPageSize = 10,
}: UseAdminStaffOptions = {}) {
  const [admins, setAdmins] = useState<ActiveAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // Client-side pagination
  const pagination = usePagination(admins, pageSize);
  const pagedAdmins = pagination.getPage(page);
  const totalPages = pagination.totalPages;

  /**
   * Fetch active admins/staff
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchActiveStaff();
      setAdmins(data.admins || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load staff");
    }

    setLoading(false);
  }, []);

  return {
    // State
    admins: pagedAdmins,
    allAdmins: admins,
    loading,
    error,
    page,
    totalPages,
    pageSize,

    // Setters
    setPage,
    setPageSize,

    // Actions
    refresh,
  };
}

export type AdminStaffController = ReturnType<typeof useAdminStaff>;
