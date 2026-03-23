ALTER TABLE public.resort_ops_bookings
  ADD COLUMN IF NOT EXISTS payment_status text;
