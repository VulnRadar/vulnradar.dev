-- Admin Notifications Table
-- Stores configurable site-wide notifications managed by admins

CREATE TABLE IF NOT EXISTS admin_notifications (
    id SERIAL PRIMARY KEY,
    
    -- Content
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    
    -- Type: banner, modal, toast, bell (notification center)
    type VARCHAR(20) NOT NULL DEFAULT 'bell' CHECK (type IN ('banner', 'modal', 'toast', 'bell')),
    
    -- Variant/severity: info, success, warning, error
    variant VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (variant IN ('info', 'success', 'warning', 'error')),
    
    -- Targeting
    audience VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'authenticated', 'unauthenticated', 'admin', 'staff')),
    path_pattern VARCHAR(255) DEFAULT NULL, -- e.g., '/dashboard*' or NULL for all pages
    
    -- Scheduling
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    ends_at TIMESTAMPTZ DEFAULT NULL, -- NULL = no end date
    
    -- Display settings
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_dismissible BOOLEAN NOT NULL DEFAULT true,
    dismiss_duration_hours INTEGER DEFAULT NULL, -- NULL = permanent dismiss, else re-show after X hours
    
    -- Action button (optional)
    action_label VARCHAR(100) DEFAULT NULL,
    action_url VARCHAR(500) DEFAULT NULL,
    action_external BOOLEAN DEFAULT false, -- open in new tab
    
    -- Priority (higher = shown first)
    priority INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient querying of active notifications
CREATE INDEX IF NOT EXISTS idx_admin_notifications_active 
ON admin_notifications (is_active, starts_at, ends_at) 
WHERE is_active = true;

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_admin_notifications_type 
ON admin_notifications (type);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_admin_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_admin_notifications_updated_at ON admin_notifications;
CREATE TRIGGER trigger_admin_notifications_updated_at
    BEFORE UPDATE ON admin_notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_notifications_updated_at();

-- Seed initial notifications
-- NOTE: These are examples. Admins can manage notifications via the admin panel.
-- The INSERT uses ON CONFLICT DO NOTHING to avoid duplicates on re-runs.

INSERT INTO admin_notifications (title, message, type, variant, audience, is_active, is_dismissible, action_label, action_url, action_external, priority) 
SELECT * FROM (VALUES
    -- Example: Version update notification for all authenticated users
    ('New Version Available', 'VulnRadar has been updated with new features and improvements. Check out the changelog!', 'bell', 'info', 'authenticated', false, true, 'View Changelog', '/changelog', false, 10),
    
    -- Example: Staff notification for version sync issues
    ('Version Sync Notice', 'Your local version may be out of sync. Please check the admin panel for details.', 'bell', 'warning', 'staff', false, true, 'Admin Panel', '/admin', false, 50)
) AS v(title, message, type, variant, audience, is_active, is_dismissible, action_label, action_url, action_external, priority)
WHERE NOT EXISTS (SELECT 1 FROM admin_notifications LIMIT 1);
