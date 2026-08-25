"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/config/constants";

export interface Teammate {
  id: number;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

// Module-level cache so the many per-finding remediation controls share one
// fetch instead of each hitting /teams/teammates on expand.
let cache: Teammate[] | null = null;
let inflight: Promise<Teammate[]> | null = null;

async function load(): Promise<Teammate[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch(API.TEAMS_TEAMMATES)
      .then((r) => (r.ok ? r.json() : { teammates: [] }))
      .then((d: { teammates?: Teammate[] }) => {
        cache = d.teammates ?? [];
        return cache;
      })
      .catch(() => {
        cache = [];
        return cache;
      });
  }
  return inflight;
}

/**
 * The people the caller shares a team with, for the remediation assignee
 * picker. Best-effort and cached: a solo user (no teammates) just gets an
 * empty list, and the picker falls back to a plain free-text field.
 */
export function useTeammates(): Teammate[] {
  const [teammates, setTeammates] = useState<Teammate[]>(cache ?? []);
  useEffect(() => {
    let cancelled = false;
    load().then((t) => {
      if (!cancelled) setTeammates(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return teammates;
}
