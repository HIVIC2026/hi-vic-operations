-- Run with psql -v ON_ERROR_STOP=1
-- Rollback for ai-answers-50-deposit.sql: puts the two deposit answers back to 10%.
BEGIN;
UPDATE public.ai_reply_answers SET answer = replace(answer, '50% to book the install', '10% to book the install'), updated_at = now()
 WHERE id = '442c3d48-7183-45f0-9c21-fa9d0f0368a3';
UPDATE public.ai_reply_answers SET answer = replace(answer, 'and the 50% deposit.', 'and the 10% deposit.'), updated_at = now()
 WHERE id = '0a245821-ca2c-48df-b8a7-3bdf6ba3f3c9';
COMMIT;
