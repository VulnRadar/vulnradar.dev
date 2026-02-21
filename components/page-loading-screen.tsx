'use client'

export function PageLoadingScreen() {
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50">
      <div className="space-y-4 w-full max-w-md px-4">
        {/* Header skeleton */}
        <div className="h-16 bg-muted rounded-lg animate-pulse" />
        
        {/* Main content skeleton */}
        <div className="space-y-3">
          <div className="h-12 bg-muted rounded-lg animate-pulse w-3/4" />
          <div className="h-4 bg-muted rounded animate-pulse w-full" />
          <div className="h-4 bg-muted rounded animate-pulse w-5/6" />
        </div>

        {/* Content blocks skeleton */}
        <div className="space-y-3 pt-8">
          <div className="h-32 bg-muted rounded-lg animate-pulse" />
          <div className="h-32 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>
    </div>
  )
}
