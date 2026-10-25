/**
 * One JSON write to a teams endpoint, reported the way every caller on
 * /teams wants it: it resolves when the server said yes and throws an Error
 * whose message is the sentence to show when it did not.
 *
 * That shape is what useConfirm and the rename editor both need. useConfirm
 * closes its dialog when the action resolves and keeps it open with
 * `err.message` when it throws, so a handler that returns normally after a
 * 403 reads as success. The five confirmed actions here used to catch their
 * own failures, post the message to a banner at the top of the page and
 * return, and the dialog closed on the way out whether or not anything had
 * happened. Throwing puts the reason where the person is looking.
 *
 * The server's own `error` wins over the caller's fallback, because it is the
 * one that knows why (a role ceiling, a seat cap, "Owners cannot leave"). A
 * rejected fetch has no server message at all, and its native text ("Failed to
 * fetch") is not something to show a person, so it becomes the connection
 * sentence the rest of the page already uses.
 */
export const TEAMS_UNREACHABLE =
  "We could not reach the server. Check your connection and try again.";

export async function sendTeamsRequest(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  fallback: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(TEAMS_UNREACHABLE);
  }
  if (res.ok) return;

  const data = (await res.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  throw new Error(
    typeof data?.error === "string" && data.error ? data.error : fallback,
  );
}
