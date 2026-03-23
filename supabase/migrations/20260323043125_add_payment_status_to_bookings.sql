-- Add payment_status column to resort_ops_bookings
-- 'due' = payment not yet confirmed, 'paid' = payment confirmed at checkout
ALTER TABLE resort_ops_bookings
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'due';
