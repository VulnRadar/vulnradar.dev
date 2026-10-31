/**
 * SQL expressions over scan_history.url that a query and an index must agree on.
 *
 * The definitions live in lib/database/schema/sql-fragments.mjs because the
 * boot schema builds its indexes from them and runs under plain Node, which
 * cannot import this file. Import them from here in application code.
 *
 * Postgres only uses an expression index when the query's expression is the
 * same tree as the index's. That is why these are shared strings and not
 * something each route spells out for itself: a regex that differs by one
 * character still returns the right rows, and quietly stops using the index.
 */
export {
  hostOfUrlSql,
  PUBLIC_HOST_SQL,
  URL_ORIGIN_PATH_SQL,
} from "@/lib/database/schema/sql-fragments.mjs";
