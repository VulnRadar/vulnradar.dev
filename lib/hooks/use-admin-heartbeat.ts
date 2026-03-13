'use client'

import { useEffect, useRef } from 'react'

interface AdminHeartbeatOptions {
  interval?: number // milliseconds between heartbeats (default: 60000 = 1 min)
  section?: string // current section (dashboard, users, notifications, etc)
  enabled?: boolean // whether to enable heartbeat
}

/**
 * Hook that sends periodic heartbeats to track staff activity in admin dashboard
 * Updates server every 60 seconds (configurable) with current activity status
 */
export function useAdminHeartbeat({
  interval = 60000,
  section = 'dashboard',
  enabled = true,
}: AdminHeartbeatOptions = {}) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastSectionRef = useRef(section)

  // Update section reference when it changes
  useEffect(() => {
    lastSectionRef.current = section
  }, [section])

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Send initial heartbeat immediately
    const sendHeartbeat = async () => {
      try {
        await fetch('/api/v2/admin/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: lastSectionRef.current }),
        }).catch(() => {
          // Silently fail - don't disrupt UI
          console.debug('[Admin Heartbeat] Failed to send heartbeat')
        })
      } catch {
        // Silently fail
      }
    }

    // Send initial heartbeat
    sendHeartbeat()

    // Set up interval
    intervalRef.current = setInterval(sendHeartbeat, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [interval, enabled])
}
