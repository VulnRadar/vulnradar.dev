-- Migration: Convert ip_rules to access_rules supporting both IP and URL rules
-- This migration:
-- 1. Creates new access_rules table with TEXT field for value (supports IPs and URLs)
-- 2. Migrates existing ip_rules data
-- 3. Creates proper indexes

-- Create new access_rules table
CREATE TABLE IF NOT EXISTS access_rules (
  id SERIAL PRIMARY KEY,
  rule_type VARCHAR(10) NOT NULL CHECK (rule_type IN ('whitelist', 'blacklist')),
  value_type VARCHAR(10) NOT NULL DEFAULT 'ip' CHECK (value_type IN ('ip', 'url')),
  value TEXT NOT NULL,
  description TEXT,
  reason VARCHAR(255),
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMP WITH TIME ZONE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(rule_type, value_type, value)
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_access_rules_active ON access_rules(is_active, rule_type);
CREATE INDEX IF NOT EXISTS idx_access_rules_value ON access_rules(value);
CREATE INDEX IF NOT EXISTS idx_access_rules_type ON access_rules(value_type);

-- Migrate existing ip_rules data if ip_rules table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ip_rules') THEN
    INSERT INTO access_rules (rule_type, value_type, value, description, reason, hit_count, last_hit_at, created_by, created_at, expires_at, is_active)
    SELECT 
      rule_type, 
      'ip' as value_type,
      ip_address::TEXT as value, 
      description, 
      reason, 
      hit_count, 
      last_hit_at, 
      created_by, 
      created_at, 
      expires_at, 
      is_active
    FROM ip_rules
    ON CONFLICT (rule_type, value_type, value) DO NOTHING;
  END IF;
END $$;
