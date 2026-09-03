import { notFound } from "next/navigation";

/**
 * Modal workbench. Development only.
 *
 * Every dialog in this product hides behind a scan result, an admin table row
 * or a billing state, so comparing two of them side by side used to mean
 * reproducing two unrelated app states in two tabs. That is why they drifted:
 * nobody could see them together. This page opens any of them on demand, in
 * the states that actually break layout (empty, loading, error, a wall of
 * text, two hundred rows).
 *
 * How it is kept out of production, in four independent layers:
 *
 *  1. The filename. `dev.tsx` is only in `pageExtensions` outside production
 *     (next.config.mjs), so in a production build this file is not a page, the
 *     route does not exist, and neither this module nor ./workbench is emitted.
 *     The first attempt relied on the NODE_ENV gate alone and `npm run build`
 *     still listed `/dev/modals` at 14.6 kB: the route 404'd, but it and its
 *     bundle shipped. Not built is a different claim from not reachable, and
 *     this is the layer that makes the first one true.
 *  2. This gate. `process.env.NODE_ENV` is inlined at build time, so even if
 *     the file were built the body below is `notFound()` followed by dead code,
 *     and the workbench is only reached through a dynamic import that the
 *     branch never evaluates.
 *  3. The middleware. "/dev" is deliberately absent from
 *     lib/config/public-paths.ts, so it is not a public path and an
 *     unauthenticated request is redirected to /login before it gets here.
 *  4. robots.txt. "/dev" is in DISALLOWED_PATHS in lib/seo/routes.ts, so it is
 *     never crawled and can never appear in the sitemap.
 *
 * tests/app/dev-modals-gate.test.ts asserts all four, so this cannot start
 * shipping silently.
 */
export const metadata = {
  title: "Modal workbench",
  robots: { index: false, follow: false },
};

export default async function DevModalsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  // Dynamic, not a static import: it puts the workbench in its own async chunk
  // that the production branch above can never request.
  const { ModalWorkbench } = await import("./workbench");
  return <ModalWorkbench />;
}
