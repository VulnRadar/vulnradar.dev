import { parseIdParam } from "@/lib/api/path-id";

/**
 * A row id out of a JSON body or a query string: a whole number, or the digits
 * of one. Anything else is null, so the caller can answer 400 instead of
 * handing Postgres a string it rejects with 22P02 (a 500 that names no one).
 * The digit rule and the INTEGER bound are parseIdParam's, so a body and a path
 * cannot disagree on which ids exist.
 */
export function parseRowId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? parseIdParam(String(value)) : null;
  }
  return typeof value === "string" ? parseIdParam(value) : null;
}
