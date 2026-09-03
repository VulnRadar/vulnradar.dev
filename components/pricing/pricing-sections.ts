/**
 * The measure of the two /pricing sections that have a placeholder standing in
 * for them.
 *
 * /pricing is a fullBleed PublicPageShell, so each section carries its own
 * container rather than sharing one from the shell. That is fine right up
 * until something else has to reserve the same space: PricingSkeleton wrote
 * both of these out a second time, and a second copy of a width is the exact
 * thing that drifts. Stated once here, imported by the section and by the
 * placeholder, so they cannot disagree.
 *
 * A plain .ts module rather than a const inside pricing-hero/pricing-cards:
 * both of those are "use client", and a value imported from a client module
 * into a Server Component comes back as a client reference, not a string.
 *
 * PricingFeatures and PricingCta keep their own containers, because the
 * skeleton renders those two sections for real and so has nothing to reserve.
 */
export const PRICING_HERO_SECTION =
  "max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-10 sm:pt-20 sm:pb-12";

export const PRICING_RAIL_SECTION =
  "max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16";
