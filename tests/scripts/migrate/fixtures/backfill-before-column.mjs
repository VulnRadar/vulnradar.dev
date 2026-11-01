/**
 * The shape 2.0.0-to-3.0.0.mjs shipped with (gap-migration-upgrade-path-1),
 * reduced to the three parts that matter: a table whose addTables SQL also
 * backfills it from a column, and the addColumns entry that creates that
 * column. Listed in this order it reads naturally; executed in the planner's
 * order it reads scan_history.team_id before the column exists.
 */
export const from = "2.0.0";
export const to = "3.0.0";

export const upgrade = {
  addTables: [
    {
      name: "scan_history_teams",
      sql: `
        CREATE TABLE IF NOT EXISTS scan_history_teams (
          scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          PRIMARY KEY (scan_id, team_id)
        );

        INSERT INTO scan_history_teams (scan_id, team_id)
        SELECT id, team_id FROM scan_history WHERE team_id IS NOT NULL
        ON CONFLICT (scan_id, team_id) DO NOTHING;
      `,
    },
  ],
  addColumns: [
    {
      table: "scan_history",
      column: "team_id",
      definition: "INTEGER REFERENCES teams(id) ON DELETE SET NULL",
    },
  ],
};

export const downgrade = {
  dropTables: ["scan_history_teams"],
  dropColumns: [{ table: "scan_history", column: "team_id" }],
};
