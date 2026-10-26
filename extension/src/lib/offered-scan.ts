// The "Scan this site" offer, remembered by the background.
//
// The on-page card used to send the address to scan back to the background in
// its click message, and the background scanned whatever it was handed. The
// card lives on a page the extension does not control, so that address was
// input from the page. Now the background records, when it shows the offer,
// which host and which address (origin and path, as lib/lookup-url.ts reduces
// it) it offered for that tab, and a later "reputation:scan" is honoured only
// for that tab, only while the tab is still on that host, and only for the
// recorded address.
//
// Kept in storage rather than in a variable: a Chrome service worker is
// suspended about thirty seconds after it last had work, and the card stays up
// for twenty, so the click can easily land on a worker that has restarted.

import { VULNRADAR } from "./constants";
import { get, update } from "./storage";
import type { OfferedScan } from "./storage";

/** Offers kept at once. A browser does not have this many tabs showing a card. */
const MAX_OFFERS = 64;

export async function recordOfferedScan(
  tabId: number,
  host: string,
  url: string,
  now: number = Date.now(),
): Promise<void> {
  await update("offeredScans", (current) => {
    const next: Record<string, OfferedScan> = {};
    for (const [id, offer] of Object.entries(current ?? {})) {
      if (now - offer.offeredAt < VULNRADAR.offeredScanTtlMs) next[id] = offer;
    }
    next[String(tabId)] = { host, url, offeredAt: now };
    const entries = Object.entries(next);
    if (entries.length <= MAX_OFFERS) return next;
    entries.sort(([, a], [, b]) => b.offeredAt - a.offeredAt);
    return Object.fromEntries(entries.slice(0, MAX_OFFERS));
  });
}

/** The live offer for a tab, or null when there is none or it has lapsed. */
export async function getOfferedScan(
  tabId: number,
  now: number = Date.now(),
): Promise<OfferedScan | null> {
  const offers = (await get("offeredScans")) ?? {};
  const offer = offers[String(tabId)];
  if (!offer) return null;
  return now - offer.offeredAt < VULNRADAR.offeredScanTtlMs ? offer : null;
}
