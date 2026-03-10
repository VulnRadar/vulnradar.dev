-- Add missing stripe_payment_intent_id column to billing_history
ALTER TABLE billing_history 
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
