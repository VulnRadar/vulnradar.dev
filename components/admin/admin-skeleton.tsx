import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { HealthCardSkeleton } from "@/components/admin/shared";

/**
 * Mirrors AdminContent's real layout (title, grouped sidebar nav, the System
 * Health card the panel lands on) so the route-level loading.tsx and the
 * client component's own pre-fetch state render the same shape instead of a
 * spinner followed by a differently-shaped skeleton.
 *
 * The body used to be two stat bars over an eight-row user table. That was
 * the shape of the old landing tab: Overview has been the landing tab since
 * AUDIT-014#qols-02, so the skeleton drew counters and a table, then a status
 * list arrived in their place. The width was stale for the same reason,
 * max-w-7xl against the page's max-w-6xl, so the content edge jumped too.
 */
export function AdminSkeleton() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main
        className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8"
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

          {/* Overview: the System Health card, header over a status list */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <HealthCardSkeleton />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
