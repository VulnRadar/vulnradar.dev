import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";

// Get all tags for the user (auto and user-added alike -- both are valid
// values to filter scan history by, see app/history/page.tsx's tag filter).
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const result = await pool.query(
    "SELECT DISTINCT tag FROM scan_tags WHERE user_id = $1 ORDER BY tag",
    [session.userId],
  );
  return NextResponse.json({ tags: result.rows.map((r) => r.tag) });
}

// Add/remove a tag on a scan. Every row this route INSERTs is hardcoded
// source = 'user' (auto tags are only ever written by
// lib/tags/auto-tags.ts at scan-completion time), but "remove" can target
// either kind: a user tag is deleted outright, while an auto tag (source =
// 'auto') is dismissed -- removed from view exactly like a user tag, but
// logged first to auto_tag_dismissals so Admin > Engine Feedback
// (app/api/v3/admin/engine-feedback/tags/route.ts) can later aggregate how
// often each auto-tag rule gets told it's wrong. See the "remove" branch
// below.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  // rate-limit: per-user cap on tag add/remove calls. Cheap to spam
  // otherwise (no external cost like AI or email, but still unbounded
  // writes against a user's own history without this).
  const rl = await checkRateLimit({
    key: `scan-tags:${session.userId}`,
    ...RATE_LIMITS.scanTags,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many tag changes. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  const { scanId, tag, action } = await request.json();

  if (!scanId || !tag || typeof tag !== "string") {
    return NextResponse.json(
      { error: "scanId and tag are required." },
      { status: 400 },
    );
  }

  const maxTagLength = await getSetting("MAX_TAG_LENGTH");
  const cleanTag = tag.trim().toLowerCase().slice(0, maxTagLength);
  if (!cleanTag)
    return NextResponse.json({ error: "Invalid tag." }, { status: 400 });

  // Verify scan belongs to user
  const scanCheck = await pool.query(
    "SELECT id FROM scan_history WHERE id = $1 AND user_id = $2",
    [scanId, session.userId],
  );
  if (scanCheck.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  if (action === "remove") {
    // An auto tag is a computed fact about the scan's findings, so removing
    // one is a "dismissal", not a plain delete: the row still disappears
    // from view, but only after logging {tag, scan_id, dismissed_by,
    // dismissed_at} to auto_tag_dismissals, which survives for aggregation
    // even though the scan_tags row itself is gone. cleanTag is always
    // lowercased above, but every auto-tag label is Title Case (see
    // lib/tags/auto-tags.ts), so this lookup compares case-insensitively --
    // a plain `tag = cleanTag` match would never find the auto tag at all.
    // Scoped to source = 'auto' so it can't false-positive on a same-named
    // user tag. This never causes the tag to reappear on a later scan of
    // the same URL: auto tags are computed once, at scan-completion time,
    // for that one scanId only (saveAutoTags is insert-only, never
    // resynced -- see its own comment), and a rescan creates an entirely
    // new scan_history row with its own fresh tag set.
    const autoMatch = await pool.query(
      "SELECT tag FROM scan_tags WHERE scan_id = $1 AND user_id = $2 AND source = 'auto' AND LOWER(tag) = LOWER($3)",
      [scanId, session.userId, cleanTag],
    );
    if (autoMatch.rows.length > 0) {
      const exactTag = autoMatch.rows[0].tag;
      await pool.query(
        "INSERT INTO auto_tag_dismissals (scan_id, tag, dismissed_by_user_id) VALUES ($1, $2, $3) ON CONFLICT (scan_id, tag) DO NOTHING",
        [scanId, exactTag, session.userId],
      );
      await pool.query(
        "DELETE FROM scan_tags WHERE scan_id = $1 AND user_id = $2 AND source = 'auto' AND tag = $3",
        [scanId, session.userId, exactTag],
      );
    } else {
      await pool.query(
        "DELETE FROM scan_tags WHERE scan_id = $1 AND user_id = $2 AND tag = $3 AND source = 'user'",
        [scanId, session.userId, cleanTag],
      );
    }
  } else {
    // Only a scan's OWN user tags count against the per-scan cap -- auto
    // tags are systemic, not something the user "used up" their quota on.
    const existingCount = await pool.query(
      "SELECT COUNT(*)::int as count FROM scan_tags WHERE scan_id = $1 AND user_id = $2 AND source = 'user' AND tag != $3",
      [scanId, session.userId, cleanTag],
    );
    const maxTagsPerScan = await getSetting("MAX_TAGS_PER_SCAN");
    if (existingCount.rows[0].count >= maxTagsPerScan) {
      return NextResponse.json(
        { error: `A scan may have at most ${maxTagsPerScan} tags.` },
        { status: 400 },
      );
    }
    await pool.query(
      "INSERT INTO scan_tags (scan_id, user_id, tag, source) VALUES ($1, $2, $3, 'user') ON CONFLICT (scan_id, tag) DO NOTHING",
      [scanId, session.userId, cleanTag],
    );
  }

  // Return the scan's updated tags, auto and user alike, so the UI can
  // re-render the whole chip row from one response.
  const tags = await pool.query(
    "SELECT tag, source FROM scan_tags WHERE scan_id = $1 AND user_id = $2 ORDER BY source, tag",
    [scanId, session.userId],
  );

  return NextResponse.json({ tags: tags.rows });
}
