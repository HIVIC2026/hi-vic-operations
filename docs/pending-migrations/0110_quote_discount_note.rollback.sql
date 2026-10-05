-- Undo for 0110_quote_discount_note.sql. App code must stop writing discount_note first.
ALTER TABLE public.quotes DROP COLUMN IF EXISTS discount_note;
