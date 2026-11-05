-- Run with psql -v ON_ERROR_STOP=1
-- ai-answers-50-deposit.sql (5 Nov 2026, Jo: 50% deposit, was 10%): changes ONLY "10%" → "50%" in the two AI reply
-- answers that state the deposit ("Payment plan", "Paying by card"). Matches the exact current wording, so a row someone
-- has edited since is left alone (fail closed: the check below aborts unless both rows now say 50%).
-- Proven on PGlite: tests/ai-answers-50-deposit-db.test.ts. ROLLBACK: ai-answers-50-deposit.rollback.sql.
-- NEVER run live without Jo's go-ahead.
BEGIN;
UPDATE public.ai_reply_answers
   SET answer = replace(answer, '10% to book the install', '50% to book the install'), updated_at = now()
 WHERE id = '442c3d48-7183-45f0-9c21-fa9d0f0368a3' AND answer LIKE '%10\% to book the install%';
UPDATE public.ai_reply_answers
   SET answer = replace(answer, 'and the 10% deposit.', 'and the 50% deposit.'), updated_at = now()
 WHERE id = '0a245821-ca2c-48df-b8a7-3bdf6ba3f3c9' AND answer LIKE '%and the 10\% deposit.%';
DO $check$
BEGIN
  IF (SELECT count(*) FROM public.ai_reply_answers
       WHERE id IN ('442c3d48-7183-45f0-9c21-fa9d0f0368a3', '0a245821-ca2c-48df-b8a7-3bdf6ba3f3c9')
         AND answer LIKE '%50\%%' AND answer NOT LIKE '%10\%%') <> 2 THEN
    RAISE EXCEPTION 'AI answers not both on 50%%; nothing changed';
  END IF;
END
$check$;
COMMIT;
