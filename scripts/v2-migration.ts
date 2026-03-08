import { neon } from "@neondatabase/serverless"
import { randomBytes, scryptSync } from "node:crypto"

// Password hashing (same as lib/auth.ts)
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required")
    process.exit(1)
  }

  const sql = neon(databaseUrl)
  console.log("Starting v2 migration...")

  // ── Subscriptions & Billing ────────────────────────────────────
  console.log("Creating subscriptions table...")
  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      stripe_customer_id VARCHAR(255) UNIQUE,
      stripe_subscription_id VARCHAR(255) UNIQUE,
      plan VARCHAR(50) NOT NULL DEFAULT 'free',
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      current_period_start TIMESTAMP WITH TIME ZONE,
      current_period_end TIMESTAMP WITH TIME ZONE,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan)`

  // ── Daily Request Limits ───────────────────────────────────────
  console.log("Creating daily_request_limits table...")
  await sql`
    CREATE TABLE IF NOT EXISTS daily_request_limits (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      request_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, date)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_daily_limits_user_date ON daily_request_limits(user_id, date)`

  // ── Roles ──────────────────────────────────────────────────────
  console.log("Creating roles table...")
  await sql`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      description TEXT,
      color VARCHAR(20),
      priority INTEGER NOT NULL DEFAULT 0,
      is_system BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name)`
  await sql`CREATE INDEX IF NOT EXISTS idx_roles_priority ON roles(priority)`

  // ── Permissions ────────────────────────────────────────────────
  console.log("Creating permissions table...")
  await sql`
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(150) NOT NULL,
      description TEXT,
      category VARCHAR(50),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name)`
  await sql`CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category)`

  // ── Role Permissions ───────────────────────────────────────────
  console.log("Creating role_permissions table...")
  await sql`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, permission_id)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id)`

  // ── User Roles ─────────────────────────────────────────────────
  console.log("Creating user_roles table...")
  await sql`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      assigned_by INTEGER,
      PRIMARY KEY (user_id, role_id)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id)`

  // ── User Permission Tags ───────────────────────────────────────
  console.log("Creating user_permission_tags table...")
  await sql`
    CREATE TABLE IF NOT EXISTS user_permission_tags (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      tag_role_id INTEGER NOT NULL,
      assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_user_permission_tags_user ON user_permission_tags(user_id)`

  // ── Beta Features ──────────────────────────────────────────────
  console.log("Creating beta_features table...")
  await sql`
    CREATE TABLE IF NOT EXISTS beta_features (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      enabled BOOLEAN NOT NULL DEFAULT false,
      rollout_percentage INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_beta_features_name ON beta_features(name)`

  // ── User Beta Access ───────────────────────────────────────────
  console.log("Creating user_beta_access table...")
  await sql`
    CREATE TABLE IF NOT EXISTS user_beta_access (
      user_id INTEGER NOT NULL,
      feature_id INTEGER NOT NULL,
      granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      granted_by INTEGER,
      PRIMARY KEY (user_id, feature_id)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_user_beta_user ON user_beta_access(user_id)`

  // ── Billing History ────────────────────────────────────────────
  console.log("Creating billing_history table...")
  await sql`
    CREATE TABLE IF NOT EXISTS billing_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      stripe_invoice_id VARCHAR(255) UNIQUE,
      amount_cents INTEGER NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'usd',
      status VARCHAR(50) NOT NULL,
      description TEXT,
      invoice_pdf_url TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_billing_history_user ON billing_history(user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_billing_history_created ON billing_history(created_at)`

  // ── Seed Default Roles ─────────────────────────────────────────
  console.log("Seeding default roles...")
  await sql`
    INSERT INTO roles (name, display_name, description, color, priority, is_system)
    VALUES 
      ('user', 'User', 'Standard user with basic access', NULL, 0, true),
      ('beta_tester', 'Beta Tester', 'Access to beta features and early releases', '#10b981', 1, true),
      ('support', 'Support', 'Customer support team member', '#3b82f6', 2, true),
      ('moderator', 'Moderator', 'Content and user moderation access', '#f59e0b', 3, true),
      ('admin', 'Admin', 'Full administrative access', '#ef4444', 4, true)
    ON CONFLICT (name) DO NOTHING
  `

  // ── Seed Default Permissions ───────────────────────────────────
  console.log("Seeding default permissions...")
  await sql`
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
    ON CONFLICT (name) DO NOTHING
  `

  // ── Create Beta Admin User ─────────────────────────────────────
  console.log("Creating beta admin user...")
  
  const betaEmail = "beta@vulnradar.dev"
  const betaPassword = "BetaTest123!"
  const hashedPassword = hashPassword(betaPassword)
  
  // Check if user already exists
  const existingUser = await sql`SELECT id FROM users WHERE email = ${betaEmail}`
  
  let userId: number
  
  if (existingUser.length > 0) {
    // Update existing user's password
    userId = existingUser[0].id
    await sql`
      UPDATE users 
      SET password_hash = ${hashedPassword}, 
          role = 'admin',
          email_verified = true,
          tos_accepted = true,
          updated_at = NOW()
      WHERE id = ${userId}
    `
    console.log(`Updated existing beta user (ID: ${userId})`)
  } else {
    // Create new user
    const newUser = await sql`
      INSERT INTO users (name, email, password_hash, role, email_verified, tos_accepted, created_at)
      VALUES ('Beta Admin', ${betaEmail}, ${hashedPassword}, 'admin', true, true, NOW())
      RETURNING id
    `
    userId = newUser[0].id
    console.log(`Created new beta user (ID: ${userId})`)
  }
  
  // Assign admin role to user
  const adminRole = await sql`SELECT id FROM roles WHERE name = 'admin'`
  if (adminRole.length > 0) {
    await sql`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (${userId}, ${adminRole[0].id})
      ON CONFLICT (user_id, role_id) DO NOTHING
    `
    console.log("Assigned admin role to beta user")
  }
  
  // Create free subscription for user
  await sql`
    INSERT INTO subscriptions (user_id, plan, status)
    VALUES (${userId}, 'free', 'active')
    ON CONFLICT (user_id) DO UPDATE SET plan = 'free', status = 'active'
  `
  console.log("Created subscription for beta user")

  console.log("\n========================================")
  console.log("Migration complete!")
  console.log("========================================")
  console.log("\nBeta Admin Credentials:")
  console.log(`  Email:    ${betaEmail}`)
  console.log(`  Password: ${betaPassword}`)
  console.log("\nYou can now login at /login")
  console.log("========================================\n")
}

migrate().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
