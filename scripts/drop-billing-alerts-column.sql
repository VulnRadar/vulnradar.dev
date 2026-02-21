-- Remove the billing_alerts column since billing is not a feature
ALTER TABLE notification_preferences DROP COLUMN IF EXISTS email_billing_alerts;
