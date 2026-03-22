-- Fix room_transactions.unit_id FK: it was incorrectly referencing units(id)
-- but the entire application uses resort_ops_units.id as the unit identifier.
ALTER TABLE public.room_transactions DROP CONSTRAINT room_transactions_unit_id_fkey;
ALTER TABLE public.room_transactions ADD CONSTRAINT room_transactions_unit_id_fkey
  FOREIGN KEY (unit_id) REFERENCES public.resort_ops_units(id) ON DELETE SET NULL;
