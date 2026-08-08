import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { StatBarSkeleton, DataTableSkeleton } from "@/components/admin/shared";

/**
 * Mirrors AdminContent's real layout (title, grouped sidebar nav, stat
 * bars, user table) so the route-level loading.tsx and the client
 * component's own pre-fetch state render the same shape instead of a
 * spinner followed by a differently-shaped skeleton.
 */
export function AdminSkeleton() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main
        className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8"
        role="status"
        aria-live="polite"
        aria-label="Loading admin panel"
      >
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage users, monitor activity, and control system settings.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar nav groups */}
          <div className="hidden lg:block lg:w-52 shrink-0 space-y-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2.5 w-16 rounded bg-muted animate-pulse ml-2.5" />
                <div className="h-8 rounded-lg bg-muted/60 animate-pulse" />
                <div className="h-8 rounded-lg bg-muted/60 animate-pulse" />
              </div>
            ))}
          </div>

          {/* Stat bars + user table */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <StatBarSkeleton segments={5} />
            <StatBarSkeleton segments={5} />
            <DataTableSkeleton rows={8} />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
