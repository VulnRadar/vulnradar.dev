/**
 * Cache headers for a social card whose contents come out of the database.
 *
 * Its own module rather than a second export from ./card, because that file
 * is JSX and this value has to be importable from anything that only wants
 * the header, including a test.
 *
 * next/og stamps `public, immutable, no-transform, max-age=31536000` on every
 * response it builds outside development (see node_modules/next/dist/compiled/
 * @vercel/og), and Next's generated metadata route returns the handler's
 * response untouched, so that header is what actually shipped. A year of
 * `immutable` is right for a card compiled into the build and wrong for one
 * that answers a share token: revoking a link stops the report loading at
 * once, and then the unfurl in Slack keeps showing the host and its severity
 * counts from any cache that saw it, for a year, because we told every cache
 * the answer would never change. Same for a host card after the scan behind
 * it is made private, which deletes the row the card reads.
 *
 * Five minutes still absorbs the burst when a link is pasted into a channel
 * and every client unfurls it at once, which is the load this cache exists
 * for, and bounds how long a revoked link keeps unfurling.
 *
 * Pass it as `new ImageResponse(el, { ...OG_SIZE, headers: OG_LIVE_DATA_HEADERS })`.
 */
export const OG_LIVE_DATA_HEADERS = {
  "cache-control": "public, max-age=300, s-maxage=300",
} as const;
