import { NextRequest, NextResponse } from "next/server";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { readAvatarFile } from "@/lib/uploads/avatar-storage";

/**
 * GET /api/v3/avatar/[userId] - serve a locally stored avatar file.
 *
 * Public on purpose (registered in lib/config/public-paths.ts): avatars
 * already render on logged-out surfaces today (shared scan reports,
 * app/shared/[token]), the same way a Discord CDN or Gravatar avatar_url
 * already does. No session check here would change that; it would only
 * break avatars on those public pages.
 */
export const GET = withErrorHandling(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ userId: string }> },
  ) => {
    const { userId: rawUserId } = await params;
    const userId = Number.parseInt(rawUserId, 10);

    // Reject anything that isn't a canonical positive integer (also
    // blocks path-traversal-shaped segments like "..") before it ever
    // reaches the filesystem helper.
    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      String(userId) !== rawUserId
    ) {
      return ApiResponse.notFound("Avatar not found.");
    }

    const file = await readAvatarFile(userId);
    if (!file) {
      return ApiResponse.notFound("Avatar not found.");
    }

    // Buffer's backing ArrayBufferLike (Node's typed-array generics) isn't
    // assignable to the DOM lib's BufferSource (which wants a concrete
    // ArrayBuffer), so copy into a plain Uint8Array for the Response body.
    const body = new Uint8Array(file.bytes);
    return new NextResponse(body, {
      headers: {
        "Content-Type": file.mime,
        // Safe to cache aggressively: the stored avatar_url carries a
        // cache-busting `v` query param that changes on every re-upload,
        // so this exact URL's content never changes.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  },
);
