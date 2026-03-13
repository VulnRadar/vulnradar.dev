'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

interface AdminHeartbeatOptions {
  interval?: number  // ms between heartbeats, default 60s
  enabled?: boolean  // only fires when true (i.e. user is staff)
}

/**
 * Global staff heartbeat hook.
 * Tracks staff presence across the entire app — not just the admin panel.
 * The "section" is derived from the current pathname automatically.
 */
export function useAdminHeartbeat({
  interval = 60000,
  enabled = true,
}: AdminHeartbeatOptions = {}) {
  const pathname = usePathname()
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const pathnameRef = useRef(pathname)

  // Always keep the ref fresh so the interval closure picks up route changes
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const sendHeartbeat = async () => {
      // Derive a human-readable section label from the pathname
      const path = pathnameRef.current || '/'
      let section = 'app'
      if (path.startsWith('/admin')) section = 'admin'
      else if (path.startsWith('/dashboard')) section = 'dashboard'
      else if (path.startsWith('/profile')) section = 'profile'
      else if (path.startsWith('/teams')) section = 'teams'
      else if (path.startsWith('/scan')) section = 'scan'
      else if (path.startsWith('/history')) section = 'history'
      else if (path.startsWith('/staff')) section = 'staff'

      try {
        await fetch('/api/v2/admin/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section }),
        })
      } catch {
        // Silently fail — never disrupt the UI
      }
    }

    // Fire immediately on mount / when enabled flips to true
    sendHeartbeat()
    intervalRef.current = setInterval(sendHeartbeat, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [interval, enabled])
}
