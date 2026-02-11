export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { default: pool } = await import("./lib/db")

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
                                           id SERIAL PRIMARY KEY,
                                           email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

        CREATE TABLE IF NOT EXISTS sessions (
                                              id VARCHAR(64) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

        CREATE TABLE IF NOT EXISTS api_keys (
                                              id SERIAL PRIMARY KEY,
                                              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key_hash VARCHAR(255) NOT NULL,
          key_prefix VARCHAR(12) NOT NULL,
          name VARCHAR(100) NOT NULL DEFAULT 'Default',
          daily_limit INTEGER NOT NULL DEFAULT 50,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_used_at TIMESTAMP WITH TIME ZONE,
          revoked_at TIMESTAMP WITH TIME ZONE,
                                                                                              UNIQUE(key_hash)
          );

        CREATE TABLE IF NOT EXISTS api_usage (
                                               id SERIAL PRIMARY KEY,
                                               api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

        CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
        CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
        CREATE INDEX IF NOT EXISTS idx_api_usage_key_id ON api_usage(api_key_id);
        CREATE INDEX IF NOT EXISTS idx_api_usage_used_at ON api_usage(used_at);

        CREATE TABLE IF NOT EXISTS scan_history (
                                                  id SERIAL PRIMARY KEY,
                                                  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          summary JSONB NOT NULL DEFAULT '{}',
          findings JSONB NOT NULL DEFAULT '[]',
          findings_count INTEGER NOT NULL DEFAULT 0,
          duration INTEGER NOT NULL DEFAULT 0,
          scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scan_history' AND column_name = 'findings'
          ) THEN
        ALTER TABLE scan_history ADD COLUMN findings JSONB NOT NULL DEFAULT '[]';
        END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS idx_scan_history_user_id ON scan_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_scan_history_scanned_at ON scan_history(scanned_at);

        CREATE TABLE IF NOT EXISTS data_requests (
                                                   id SERIAL PRIMARY KEY,
                                                   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          data JSONB,
          requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE
                                                                                                   );

        CREATE INDEX IF NOT EXISTS idx_data_requests_user_id ON data_requests(user_id);

        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'tos_accepted_at'
          ) THEN
        ALTER TABLE users ADD COLUMN tos_accepted_at TIMESTAMP WITH TIME ZONE;
        END IF;
        END $$;

        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scan_history' AND column_name = 'source'
          ) THEN
        ALTER TABLE scan_history ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'web';
        END IF;
        END $$;

        CREATE TABLE IF NOT EXISTS webhooks (
                                              id SERIAL PRIMARY KEY,
                                              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          name VARCHAR(100) NOT NULL DEFAULT 'Default',
          type VARCHAR(20) NOT NULL DEFAULT 'generic',
          active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

        CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);

        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'webhooks' AND column_name = 'type'
          ) THEN
        ALTER TABLE webhooks ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'generic';
        END IF;
        END $$;

        CREATE TABLE IF NOT EXISTS scheduled_scans (
                                                     id SERIAL PRIMARY KEY,
                                                     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          frequency VARCHAR(20) NOT NULL DEFAULT 'weekly',
          active BOOLEAN NOT NULL DEFAULT true,
          last_run_at TIMESTAMP WITH TIME ZONE,
          next_run_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

        CREATE INDEX IF NOT EXISTS idx_scheduled_scans_user_id ON scheduled_scans(user_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_scans_next_run ON scheduled_scans(next_run_at);

        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'totp_secret'
          ) THEN
        ALTER TABLE users ADD COLUMN totp_secret VARCHAR(255);
        ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false;
        END IF;
        END $$;

        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'is_admin'
          ) THEN
        ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
        END IF;
        END $$;

        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scan_history' AND column_name = 'share_token'
          ) THEN
        ALTER TABLE scan_history ADD COLUMN share_token VARCHAR(64) UNIQUE;
        END IF;
        END $$;

        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'backup_codes'
          ) THEN
        ALTER TABLE users ADD COLUMN backup_codes TEXT;
        END IF;
        END $$;
      `)

      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_audit_log (
                                                     id SERIAL PRIMARY KEY,
                                                     admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_user_id INTEGER,
          action VARCHAR(100) NOT NULL,
          details TEXT,
          ip_address VARCHAR(45),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
      `)

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_log(admin_id);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at);
      `)

      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'disabled_at'
          ) THEN
            ALTER TABLE users ADD COLUMN disabled_at TIMESTAMP WITH TIME ZONE;
          END IF;
        END $$;
      `)

      // Password reset tokens
      await pool.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
                                                           id SERIAL PRIMARY KEY,
                                                           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          used_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);
      `)

      // Rate limiting
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rate_limits (
                                                 id SERIAL PRIMARY KEY,
                                                 key VARCHAR(255) NOT NULL,
          "count" INTEGER NOT NULL DEFAULT 1,
          window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE(key, window_start)
          );
        CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
        CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
      `)

      // Scan tags
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scan_tags (
                                               id SERIAL PRIMARY KEY,
                                               user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
          tag VARCHAR(50) NOT NULL,
          UNIQUE(scan_id, tag)
          );
        CREATE INDEX IF NOT EXISTS idx_scan_tags_scan_id ON scan_tags(scan_id);
        CREATE INDEX IF NOT EXISTS idx_scan_tags_user_id ON scan_tags(user_id);
        CREATE INDEX IF NOT EXISTS idx_scan_tags_tag ON scan_tags(tag);
      `)

      // Teams
      await pool.query(`
        CREATE TABLE IF NOT EXISTS teams (
                                           id SERIAL PRIMARY KEY,
                                           name VARCHAR(100) NOT NULL,
          slug VARCHAR(100) UNIQUE NOT NULL,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

        CREATE TABLE IF NOT EXISTS team_members (
                                                  id SERIAL PRIMARY KEY,
                                                  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role VARCHAR(20) NOT NULL DEFAULT 'viewer',
          joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(team_id, user_id)
          );
        CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
        CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

        CREATE TABLE IF NOT EXISTS team_invites (
                                                  id SERIAL PRIMARY KEY,
                                                  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL DEFAULT 'viewer',
          token VARCHAR(64) NOT NULL UNIQUE,
          invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          accepted_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token);
        CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email);
      `)

      // Onboarding column
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'onboarding_completed'
          ) THEN
            ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT false;
          END IF;
        END $$;
      `)

      // Add IP address tracking to sessions
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'sessions' AND column_name = 'ip_address'
          ) THEN
            ALTER TABLE sessions ADD COLUMN ip_address VARCHAR(45);
          END IF;
        END $$;
      `)

      // Add user_agent tracking to sessions
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'sessions' AND column_name = 'user_agent'
          ) THEN
            ALTER TABLE sessions ADD COLUMN user_agent TEXT;
          END IF;
        END $$;
      `)

      console.log("[VulnRadar] Database schema verified / migrated successfully.")

      // Cleanup: expired sessions, old api_usage (> 90 days), old revoked keys (> 30 days), old data requests (> 60 days)
      try {
        const cleanupResult = await pool.query(`
          DELETE FROM sessions WHERE expires_at < NOW();
          DELETE FROM api_usage WHERE used_at < NOW() - INTERVAL '90 days';
          DELETE FROM api_keys WHERE revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days';
          DELETE FROM data_requests WHERE requested_at < NOW() - INTERVAL '60 days';
          DELETE FROM scan_history WHERE scanned_at < NOW() - INTERVAL '90 days';
          DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day';
          DELETE FROM password_reset_tokens WHERE expires_at < NOW();
          DELETE FROM team_invites WHERE expires_at < NOW() AND accepted_at IS NULL;
        `)
        console.log("[VulnRadar] Cleanup completed successfully.")
      } catch (cleanupError) {
        console.error("[VulnRadar] Cleanup failed (non-fatal):", cleanupError)
      }
    } catch (error) {
      console.error("[VulnRadar] Database migration failed:", error)
    } finally {
      await pool.end()
    }
  }
}
