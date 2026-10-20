-- Before-use rollback only. Stop scheduled/manual Outlook sync and revert dependent code first.
-- A used queue is permanent history: retain it and use a forward repair instead of dropping data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.outlook_message_work)
    OR EXISTS (SELECT 1 FROM public.outlook_sync_state
      WHERE expected_mailbox IS NOT NULL OR inbox_next_link IS NOT NULL OR sent_next_link IS NOT NULL) THEN
    RAISE EXCEPTION 'Outlook recovery is already in use: preserve its queue/configuration and use a forward repair';
  END IF;
END $$;
DROP FUNCTION public.confirm_outlook_mailbox(text,uuid);
DROP FUNCTION public.finish_outlook_message(text,jsonb);
DROP FUNCTION public.begin_outlook_message(text,jsonb,jsonb);
DROP TABLE public.outlook_message_work;
DROP FUNCTION public.guard_outlook_message_work();
ALTER TABLE public.outlook_sync_state
  DROP COLUMN expected_mailbox,
  DROP COLUMN inbox_next_link,
  DROP COLUMN sent_next_link;
