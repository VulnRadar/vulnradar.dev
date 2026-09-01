/**
 * Seed data that both the boot path and `npm run db:create` insert.
 *
 * Not schema, so it is not a SchemaStep: register() seeds after the schema is
 * applied, and db:create seeds only when it is NOT copying badges out of a
 * source database (copying the source's rows and then seeding would leave
 * user_badges pointing at badge ids that no longer mean the same thing).
 *
 * It lives here because the two paths had drifted into two different badge
 * sets: the boot path seeded eight badges, db:create seeded six, and the four
 * names they shared disagreed on icon, colour and priority. A database cloned
 * with db:create therefore rendered different badges than the same database
 * booted. One definition, both callers.
 */
export const DEFAULT_BADGES_SQL = `
  INSERT INTO badges (name, display_name, description, icon, color, priority, is_limited)
  VALUES
    ('beta_tester', 'Beta Tester', 'Early beta program participant', 'flask', '#10b981', 10, true),
    ('early_supporter', 'Early Supporter', 'Supported the project early on', 'heart', '#ec4899', 9, true),
    ('founder', 'Founder', 'Original founding member', 'crown', '#f59e0b', 20, true),
    ('contributor', 'Contributor', 'Open source contributor', 'code', '#8b5cf6', 8, false),
    ('bug_hunter', 'Bug Hunter', 'Found and reported bugs', 'bug', '#ef4444', 7, false),
    ('verified', 'Verified', 'Verified account', 'badge-check', '#3b82f6', 5, false),
    ('premium', 'Premium', 'Premium subscription member', 'star', '#fbbf24', 6, false),
    ('staff', 'Staff', 'VulnRadar team member', 'shield', '#6366f1', 15, true)
  ON CONFLICT (name) DO NOTHING;
`;
