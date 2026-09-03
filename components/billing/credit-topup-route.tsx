import "server-only";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ROUTES } from "@/lib/config/client-constants";
import { CREDIT_KINDS, type CreditKindId } from "./credit-kinds";
import { loadCreditSnapshot } from "./credit-usage";
import { CreditTopUp } from "./credit-topup";

/**
 * The server half of /ai-credits, /github-credits and /browser-credits.
 *
 * Reads the balance before rendering rather than after, so the page paints the
 * real number on the first frame. The three pages this replaces each opened
 * with a full-screen skeleton while fetching /api/v3/auth/me to decide whether
 * to redirect to login, which middleware.ts has already decided before this
 * route runs. The session read below is the belt to that braces: a cookie that
 * is present but expired gets past middleware, and this turns it into the same
 * login redirect instead of a page with no numbers on it.
 */
export async function CreditTopUpRoute({ kindId }: { kindId: CreditKindId }) {
  const session = await getSession();
  if (!session) {
    redirect(`${ROUTES.LOGIN}?redirect=${CREDIT_KINDS[kindId].path}`);
  }

  const snapshot = await loadCreditSnapshot(session.userId, kindId);
  return <CreditTopUp kindId={kindId} snapshot={snapshot} />;
}
