-- Admin Notifications Table
-- Stores configurable site-wide notifications managed by admins

CREATE TABLE IF NOT EXISTS admin_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
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
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
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

-- Seed initial notifications (migrated from hardcoded ones)
INSERT INTO admin_notifications (title, message, type, variant, audience, is_active, is_dismissible, action_label, action_url, action_external, priority) VALUES
-- Version update notification (bell)
('New Version Available', 'VulnRadar has been updated! Check out the changelog for new features and improvements.', 'bell', 'info', 'authenticated', true, true, 'View Changelog', '/changelog', false, 10),

-- Discord invite (bell)
('Join Our Community', 'Connect with other security professionals on our Discord server.', 'bell', 'info', 'authenticated', true, true, 'Join Discord', 'https://discord.gg/vulnradar', true, 5),

-- Welcome notification (bell)
('Welcome to VulnRadar', 'Start scanning your websites for vulnerabilities with our comprehensive security scanner.', 'bell', 'success', 'authenticated', true, true, 'Start Scanning', '/dashboard', false, 1)

ON CONFLICT DO NOTHING;
