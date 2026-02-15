-- Add response_headers column to scan_history table
ALTER TABLE scan_history ADD COLUMN IF NOT EXISTS response_headers JSONB;
