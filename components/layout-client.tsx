'use client'

import { ReactNode } from 'react'
import { useAuth } from '@/components/auth-provider'
import { PageLoadingScreen } from '@/components/page-loading-screen'

export function LayoutClient({ children }: { children: ReactNode }) {
  const { isLoading } = useAuth()

  if (isLoading) {
    return <PageLoadingScreen />
  }

  return <>{children}</>
}
