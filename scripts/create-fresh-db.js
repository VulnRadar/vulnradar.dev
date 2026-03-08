#!/usr/bin/env node
/**
 * VulnRadar v2.0 - Fresh Database Creation & Migration Script
 * 
 * This script creates a new database with the complete v2 schema,
 * migrates data from an existing database if specified, and sets up
 * all required tables, roles, permissions, and badges.
 * 
 * Usage:
 *   node scripts/create-fresh-db.js
 * 
 * Environment Variables:
 *   DATABASE_URL - Source database connection string (existing DB to migrate from)
 *   NEW_DATABASE_NAME - Name for the new database (default: vulnradar_v2)
 * 
 * The script will prompt for values if not provided via environment.
 */

const { Pool } = require("pg")
const { randomBytes, scryptSync } = require("crypto")
const readline = require("readline")

// ============================================================================
// CONFIGURATION
// ============================================================================

const SCHEMA_VERSION = "2.0.0"
const APP_NAME = "VulnRadar"

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(message, type = "info") {
  const prefix = `[${APP_NAME}]`
  const colors = {
    info: "\x1b[36m",
    success: "\x1b[32m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
    reset: "\x1b[0m"
  }
  console.log(`${colors[type]}${prefix}${colors.reset} ${message}`)
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

const SCHEMA_SQL = `
-- ============================================================================
-- VulnRadar v2.0 Database Schema
-- Generated: ${new Date().toISOString()}
-- Schema Version: ${SCHEMA_VERSION}
-- ============================================================================

-- ── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  avatar_url TEXT,
  tos_accepted_at TIMESTAMP WITH TIME ZONE,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  disabled_at TIMESTAMP WITH TIME ZONE,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  totp_secret VARCHAR(255),
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  two_factor_method VARCHAR(10),
  backup_codes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ── Sessions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ── API Keys ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  key_encrypted TEXT,
  key_prefix VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL DEFAULT 'Default',
  daily_limit INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- ── API Usage ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_usage (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage(api_key_id);

-- ── Scan History ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  shared_token VARCHAR(64),
  shared_at TIMESTAMP WITH TIME ZONE,
  source VARCHAR(20) DEFAULT 'web',
  tags TEXT[],
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_history_user_id ON scan_history(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_history_shared_token ON scan_history(shared_token);
CREATE INDEX IF NOT EXISTS idx_scan_history_created_at ON scan_history(created_at);
CREATE INDEX IF NOT EXISTS idx_scan_history_url ON scan_history(url);

-- ── Password Reset Tokens ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);

-- ── Email Verification Tokens ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);

-- ── Contact Messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_user_id ON contact_messages(user_id);

-- ── Webhooks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  secret VARCHAR(64) NOT NULL,
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);

-- ── Scheduled Scans ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_scans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  cron_expression VARCHAR(100) NOT NULL,
  last_run_at TIMESTAMP WITH TIME ZONE,
  next_run_at TIMESTAMP WITH TIME ZONE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_scans_user_id ON scheduled_scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_scans_next_run ON scheduled_scans(next_run_at);

-- ── Admin Audit Logs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at);

-- ── Data Export Requests ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_export_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  file_path TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_data_export_user ON data_export_requests(user_id);

-- ── Teams ───────────────────────────────────────────────────────────────────
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

-- ── Badges (v2.0) - Cosmetic display badges ─────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  color VARCHAR(20),
  priority INTEGER NOT NULL DEFAULT 0,
  is_limited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_badges_name ON badges(name);
CREATE INDEX IF NOT EXISTS idx_badges_priority ON badges(priority);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge ON user_badges(badge_id);

-- ── Subscriptions & Billing (v2.0) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id VARCHAR(255) UNIQUE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  plan VARCHAR(50) NOT NULL DEFAULT 'free',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan);

-- ── Daily Request Limits (v2.0) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_request_limits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_limits_user_date ON daily_request_limits(user_id, date);

-- ── Roles & Permissions (v2.0) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(20),
  priority INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_roles_priority ON roles(priority);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(150) NOT NULL,
  description TEXT,
  category VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

CREATE TABLE IF NOT EXISTS user_permission_tags (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  tag_role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_permission_tags_user ON user_permission_tags(user_id);

-- ── Beta Features (v2.0) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beta_features (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_beta_features_name ON beta_features(name);

CREATE TABLE IF NOT EXISTS user_beta_access (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_id INTEGER NOT NULL REFERENCES beta_features(id) ON DELETE CASCADE,
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, feature_id)
);
CREATE INDEX IF NOT EXISTS idx_user_beta_user ON user_beta_access(user_id);

-- ── Billing History (v2.0) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_invoice_id VARCHAR(255) UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'usd',
  status VARCHAR(50) NOT NULL,
  description TEXT,
  invoice_pdf_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_history_user ON billing_history(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_history_created ON billing_history(created_at);

-- ── Schema Version Tracking ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`

const SEED_SQL = `
-- ============================================================================
-- Default Data Seeding
-- ============================================================================

-- Default Roles
INSERT INTO roles (name, display_name, description, color, priority, is_system)
VALUES 
  ('user', 'User', 'Standard user with basic access', NULL, 0, true),
  ('beta_tester', 'Beta Tester', 'Access to beta features and early releases', '#10b981', 1, true),
  ('support', 'Support', 'Customer support team member', '#3b82f6', 2, true),
  ('moderator', 'Moderator', 'Content and user moderation access', '#f59e0b', 3, true),
  ('admin', 'Admin', 'Full administrative access', '#ef4444', 4, true)
ON CONFLICT (name) DO NOTHING;

-- Default Permissions
INSERT INTO permissions (name, display_name, description, category)
VALUES 
  ('scan.create', 'Create Scans', 'Ability to run security scans', 'scanning'),
  ('scan.view', 'View Scans', 'Ability to view scan results', 'scanning'),
  ('scan.delete', 'Delete Scans', 'Ability to delete scan history', 'scanning'),
  ('scan.bulk', 'Bulk Scanning', 'Ability to run bulk scans', 'scanning'),
  ('api.access', 'API Access', 'Ability to use the API', 'api'),
  ('api.keys.create', 'Create API Keys', 'Ability to create API keys', 'api'),
  ('webhook.manage', 'Manage Webhooks', 'Ability to create and manage webhooks', 'integrations'),
  ('schedule.manage', 'Manage Schedules', 'Ability to create scheduled scans', 'integrations'),
  ('team.create', 'Create Teams', 'Ability to create teams', 'teams'),
  ('team.manage', 'Manage Teams', 'Ability to manage team members', 'teams'),
  ('admin.users.view', 'View Users', 'View all users in admin panel', 'admin'),
  ('admin.users.edit', 'Edit Users', 'Edit user details and roles', 'admin'),
  ('admin.users.delete', 'Delete Users', 'Delete user accounts', 'admin'),
  ('admin.scans.view', 'View All Scans', 'View all scans across users', 'admin'),
  ('admin.audit.view', 'View Audit Log', 'View admin audit log', 'admin'),
  ('admin.settings', 'System Settings', 'Access to system settings', 'admin'),
  ('beta.access', 'Beta Access', 'Access to beta features', 'beta')
ON CONFLICT (name) DO NOTHING;

-- Assign Permissions to Roles
WITH role_perms AS (
  SELECT r.id as role_id, p.id as permission_id
  FROM roles r, permissions p
  WHERE 
    (r.name = 'user' AND p.name IN ('scan.create', 'scan.view', 'scan.delete', 'api.access', 'api.keys.create'))
    OR (r.name = 'beta_tester' AND p.name IN ('scan.create', 'scan.view', 'scan.delete', 'scan.bulk', 'api.access', 'api.keys.create', 'webhook.manage', 'schedule.manage', 'beta.access'))
    OR (r.name = 'support' AND p.name IN ('scan.create', 'scan.view', 'api.access', 'admin.users.view', 'admin.scans.view'))
    OR (r.name = 'moderator' AND p.name IN ('scan.create', 'scan.view', 'scan.delete', 'scan.bulk', 'api.access', 'api.keys.create', 'admin.users.view', 'admin.users.edit', 'admin.scans.view', 'admin.audit.view'))
    OR (r.name = 'admin' AND p.name IS NOT NULL)
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, permission_id FROM role_perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Default Badges
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

-- Record schema version
INSERT INTO schema_migrations (version) VALUES ('${SCHEMA_VERSION}');
`

// ============================================================================
// MAIN MIGRATION LOGIC
// ============================================================================

async function main() {
  log("VulnRadar v2.0 Database Migration Script", "info")
  log("========================================", "info")
  console.log("")

  // Get database URL
  let sourceDbUrl = process.env.DATABASE_URL
  if (!sourceDbUrl) {
    sourceDbUrl = await prompt("Enter source DATABASE_URL (or press Enter to skip migration): ")
  }

  // Get new database name
  let newDbName = process.env.NEW_DATABASE_NAME
  if (!newDbName) {
    newDbName = await prompt("Enter new database name [vulnradar_v2]: ")
    if (!newDbName) newDbName = "vulnradar_v2"
  }

  // Parse the connection URL to get components
  let dbHost, dbPort, dbUser, dbPassword, existingDbName
  if (sourceDbUrl) {
    try {
      const url = new URL(sourceDbUrl)
      dbHost = url.hostname
      dbPort = url.port || "5432"
      dbUser = url.username
      dbPassword = url.password
      existingDbName = url.pathname.slice(1)
    } catch (e) {
      log("Invalid DATABASE_URL format", "error")
      process.exit(1)
    }
  } else {
    log("No source database provided, will create fresh database with defaults", "warn")
    dbHost = await prompt("Enter database host [localhost]: ") || "localhost"
    dbPort = await prompt("Enter database port [5432]: ") || "5432"
    dbUser = await prompt("Enter database user [postgres]: ") || "postgres"
    dbPassword = await prompt("Enter database password: ")
  }

  // Connect to postgres database (to create new database)
  const adminPool = new Pool({
    host: dbHost,
    port: parseInt(dbPort),
    user: dbUser,
    password: dbPassword,
    database: "postgres",
    ssl: dbHost !== "localhost" ? { rejectUnauthorized: false } : false
  })

  try {
    log(`Connecting to PostgreSQL server at ${dbHost}:${dbPort}...`, "info")
    
    // Check if new database already exists
    const dbCheck = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [newDbName]
    )

    if (dbCheck.rows.length > 0) {
      const answer = await prompt(`Database '${newDbName}' already exists. Drop and recreate? [y/N]: `)
      if (answer.toLowerCase() !== "y") {
        log("Aborted by user", "warn")
        process.exit(0)
      }
      
      // Terminate existing connections and drop
      await adminPool.query(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()
      `, [newDbName])
      await adminPool.query(`DROP DATABASE IF EXISTS "${newDbName}"`)
      log(`Dropped existing database '${newDbName}'`, "warn")
    }

    // Create new database
    await adminPool.query(`CREATE DATABASE "${newDbName}"`)
    log(`Created database '${newDbName}'`, "success")

  } catch (err) {
    log(`Failed to create database: ${err.message}`, "error")
    process.exit(1)
  } finally {
    await adminPool.end()
  }

  // Connect to new database
  const newPool = new Pool({
    host: dbHost,
    port: parseInt(dbPort),
    user: dbUser,
    password: dbPassword,
    database: newDbName,
    ssl: dbHost !== "localhost" ? { rejectUnauthorized: false } : false
  })

  try {
    log("Creating schema...", "info")
    await newPool.query(SCHEMA_SQL)
    log("Schema created successfully", "success")

    log("Seeding default data...", "info")
    await newPool.query(SEED_SQL)
    log("Default data seeded", "success")

    // Migrate data if source database exists
    if (sourceDbUrl && existingDbName) {
      const migrateAnswer = await prompt(`Migrate data from '${existingDbName}'? [y/N]: `)
      if (migrateAnswer.toLowerCase() === "y") {
        log("Starting data migration...", "info")
        
        const sourcePool = new Pool({ connectionString: sourceDbUrl })
        
        try {
          // Migrate users
          const users = await sourcePool.query("SELECT * FROM users")
          for (const user of users.rows) {
            await newPool.query(`
              INSERT INTO users (id, email, password_hash, name, role, avatar_url, tos_accepted_at, 
                email_verified_at, disabled_at, onboarding_completed, totp_secret, totp_enabled, 
                two_factor_method, backup_codes, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
              ON CONFLICT (id) DO NOTHING
            `, [user.id, user.email, user.password_hash, user.name, user.role, user.avatar_url,
                user.tos_accepted_at, user.email_verified_at, user.disabled_at, user.onboarding_completed,
                user.totp_secret, user.totp_enabled, user.two_factor_method, user.backup_codes,
                user.created_at, user.updated_at])
          }
          log(`Migrated ${users.rows.length} users`, "success")

          // Migrate scan_history
          const scans = await sourcePool.query("SELECT * FROM scan_history")
          for (const scan of scans.rows) {
            await newPool.query(`
              INSERT INTO scan_history (id, user_id, url, result, created_at, shared_token, shared_at, source, tags, notes)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (id) DO NOTHING
            `, [scan.id, scan.user_id, scan.url, scan.result, scan.created_at, scan.shared_token,
                scan.shared_at, scan.source, scan.tags, scan.notes])
          }
          log(`Migrated ${scans.rows.length} scan records`, "success")

          // Migrate api_keys
          const apiKeys = await sourcePool.query("SELECT * FROM api_keys")
          for (const key of apiKeys.rows) {
            await newPool.query(`
              INSERT INTO api_keys (id, user_id, key_hash, key_encrypted, key_prefix, name, daily_limit, created_at, last_used_at, revoked_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (id) DO NOTHING
            `, [key.id, key.user_id, key.key_hash, key.key_encrypted, key.key_prefix, key.name,
                key.daily_limit, key.created_at, key.last_used_at, key.revoked_at])
          }
          log(`Migrated ${apiKeys.rows.length} API keys`, "success")

          // Reset sequences
          await newPool.query("SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM users))")
          await newPool.query("SELECT setval('scan_history_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM scan_history))")
          await newPool.query("SELECT setval('api_keys_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM api_keys))")
          log("Reset sequence counters", "success")

        } catch (migErr) {
          log(`Migration error: ${migErr.message}`, "error")
        } finally {
          await sourcePool.end()
        }
      }
    }

    // Create beta admin user
    const createAdmin = await prompt("Create beta admin user? [Y/n]: ")
    if (createAdmin.toLowerCase() !== "n") {
      const adminEmail = await prompt("Admin email [beta@vulnradar.dev]: ") || "beta@vulnradar.dev"
      const adminPassword = await prompt("Admin password [BetaTest123!]: ") || "BetaTest123!"
      const hashedPassword = hashPassword(adminPassword)

      const userResult = await newPool.query(`
        INSERT INTO users (email, password_hash, name, role, email_verified_at, tos_accepted_at, onboarding_completed)
        VALUES ($1, $2, $3, 'admin', NOW(), NOW(), true)
        ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = 'admin', updated_at = NOW()
        RETURNING id
      `, [adminEmail, hashedPassword, "Beta Admin"])
      
      const userId = userResult.rows[0].id

      // Grant admin role
      const adminRole = await newPool.query("SELECT id FROM roles WHERE name = 'admin'")
      if (adminRole.rows.length > 0) {
        await newPool.query(`
          INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [userId, adminRole.rows[0].id])

        // Grant all permissions
        await newPool.query(`
          INSERT INTO role_permissions (role_id, permission_id)
          SELECT $1, id FROM permissions
          ON CONFLICT DO NOTHING
        `, [adminRole.rows[0].id])
      }

      // Grant beta tester badge
      const betaBadge = await newPool.query("SELECT id FROM badges WHERE name = 'beta_tester'")
      if (betaBadge.rows.length > 0) {
        await newPool.query(`
          INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [userId, betaBadge.rows[0].id])
      }

      // Create elite subscription
      await newPool.query(`
        INSERT INTO subscriptions (user_id, plan, status)
        VALUES ($1, 'elite', 'active')
        ON CONFLICT (user_id) DO NOTHING
      `, [userId])

      log(`Admin user created: ${adminEmail}`, "success")
    }

    // Print new connection string
    const newDbUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${newDbName}`
    console.log("")
    log("========================================", "info")
    log("Migration Complete!", "success")
    log("========================================", "info")
    console.log("")
    console.log("New DATABASE_URL:")
    console.log(`  ${newDbUrl}`)
    console.log("")
    console.log("Update your .env file with the new DATABASE_URL to use the new database.")

  } catch (err) {
    log(`Schema creation failed: ${err.message}`, "error")
    console.error(err)
    process.exit(1)
  } finally {
    await newPool.end()
  }
}

main().catch(console.error)
