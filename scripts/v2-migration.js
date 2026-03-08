// V2 Migration Script - Create tables and seed beta user
// Run with: node scripts/v2-migration.js

import pg from "pg"
import { scryptSync, randomBytes } from "crypto"

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Password hashing function (same as in lib/auth.ts)
function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return Buffer.concat([salt, hash]).toString("hex")
}

async function migrate() {
  const client = await pool.connect()

  try {
    console.log("[v2-migration] Starting database migration...")

    // Create subscriptions table
    await client.query(`
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
    `)
    console.log("[v2-migration] ✓ Created subscriptions table")

    // Create daily_request_limits table
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_request_limits (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        request_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_daily_limits_user_date ON daily_request_limits(user_id, date);
    `)
    console.log("[v2-migration] ✓ Created daily_request_limits table")

    // Create roles table
    await client.query(`
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
    `)
    console.log("[v2-migration] ✓ Created roles table")

    // Create permissions table
    await client.query(`
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
    `)
    console.log("[v2-migration] ✓ Created permissions table")

    // Create role_permissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );
      CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
    `)
    console.log("[v2-migration] ✓ Created role_permissions table")

    // Create user_roles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        PRIMARY KEY (user_id, role_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
    `)
    console.log("[v2-migration] ✓ Created user_roles table")

    // Create user_permission_tags table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_permission_tags (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        tag_role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_permission_tags_user ON user_permission_tags(user_id);
    `)
    console.log("[v2-migration] ✓ Created user_permission_tags table")

    // Create beta_features table
    await client.query(`
      CREATE TABLE IF NOT EXISTS beta_features (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        enabled BOOLEAN NOT NULL DEFAULT false,
        rollout_percentage INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_beta_features_name ON beta_features(name);
    `)
    console.log("[v2-migration] ✓ Created beta_features table")

    // Create user_beta_access table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_beta_access (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        feature_id INTEGER NOT NULL REFERENCES beta_features(id) ON DELETE CASCADE,
        granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        PRIMARY KEY (user_id, feature_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_beta_user ON user_beta_access(user_id);
    `)
    console.log("[v2-migration] ✓ Created user_beta_access table")

    // Create billing_history table
    await client.query(`
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
    `)
    console.log("[v2-migration] ✓ Created billing_history table")

    // Seed default roles
    await client.query(`
      INSERT INTO roles (name, display_name, description, color, priority, is_system)
      VALUES 
        ('user', 'User', 'Standard user with basic access', NULL, 0, true),
        ('beta_tester', 'Beta Tester', 'Access to beta features', '#10b981', 1, true),
        ('support', 'Support', 'Customer support team', '#3b82f6', 2, true),
        ('moderator', 'Moderator', 'Content moderation', '#f59e0b', 3, true),
        ('admin', 'Admin', 'Full admin access', '#ef4444', 4, true)
      ON CONFLICT (name) DO NOTHING;
    `)
    console.log("[v2-migration] ✓ Seeded default roles")

    // Create or update beta user
    const betaEmail = "beta@vulnradar.dev"
    const betaPassword = "BetaTest123!"
    const hashedPassword = hashPassword(betaPassword)

    // Check if beta user exists
    const existingUser = await client.query("SELECT id FROM users WHERE email = $1", [betaEmail])

    let userId
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id
      // Update password
      await client.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [hashedPassword, userId])
      console.log(`[v2-migration] ✓ Updated existing beta user (ID: ${userId})`)
    } else {
      // Create new beta user
      const result = await client.query(
        `INSERT INTO users (email, password_hash, name, email_verified_at, tos_accepted_at, onboarding_completed, created_at)
         VALUES ($1, $2, $3, NOW(), NOW(), true, NOW())
         RETURNING id`,
        [betaEmail, hashedPassword, "Beta Tester"]
      )
      userId = result.rows[0].id
      console.log(`[v2-migration] ✓ Created beta user (ID: ${userId})`)
    }

    // Get admin role
    const adminRole = await client.query("SELECT id FROM roles WHERE name = $1", ["admin"])
    if (adminRole.rows.length > 0) {
      const adminRoleId = adminRole.rows[0].id
      
      // Assign admin role to beta user
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, adminRoleId]
      )

      // Assign admin permission tag
      await client.query(
        `INSERT INTO user_permission_tags (user_id, tag_role_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET tag_role_id = EXCLUDED.tag_role_id`,
        [userId, adminRoleId]
      )
    }

    // Create subscription record for beta user (elite plan)
    await client.query(
      `INSERT INTO subscriptions (user_id, plan, status, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, "elite", "active"]
    )

    console.log("[v2-migration] ✓ Assigned admin role and elite subscription to beta user")
    console.log("")
    console.log("================================")
    console.log("✓ V2 Migration Complete!")
    console.log("================================")
    console.log(`Beta Admin Credentials:`)
    console.log(`Email: ${betaEmail}`)
    console.log(`Password: ${betaPassword}`)
    console.log("================================")
  } catch (error) {
    console.error("[v2-migration] Error:", error.message)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
