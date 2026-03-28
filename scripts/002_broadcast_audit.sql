-- Add audit columns to broadcast_messages for tracking who sends emails
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sent_by INTEGER REFERENCES users(id);

-- Add sent_at column to broadcast_recipients  
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE;
