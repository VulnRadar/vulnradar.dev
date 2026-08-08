import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Skeleton } from "@/components/ui/skeleton";

const TAB_COUNT = 8;

/**
 * Mirrors ProfileContent's real layout (title, sidebar tabs, content card)
 * so the route-level loading.tsx and the client component's own pre-fetch
 * state render the same shape. Two separate "loading" phases showing two
 * different layouts is what caused the visible reflow this replaces.
 */
export function ProfileSkeleton() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main
        className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-6 sm:gap-8 min-w-0"
        role="status"
        aria-live="polite"
        aria-label="Loading profile"
      >
        <div className="mb-2 space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>

        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Sidebar */}
          <aside className="lg:w-48 lg:shrink-0">
            <div className="lg:hidden overflow-x-auto -mx-4 px-4 border-b border-border/80 pb-3">
              <div className="flex gap-2 min-w-max">
                {Array.from({ length: TAB_COUNT }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-20 rounded-md shrink-0" />
                ))}
              </div>
            </div>
            <div className="hidden lg:flex flex-col gap-1.5">
              {Array.from({ length: TAB_COUNT }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-lg" />
              ))}
            </div>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
