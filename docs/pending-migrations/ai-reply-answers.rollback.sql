-- Undo ai-reply-answers.sql: drops the table (the AI goes back to the built-in seed answers).
DROP TABLE IF EXISTS public.ai_reply_answers;
