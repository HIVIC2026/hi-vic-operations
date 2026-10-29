-- Jo's standard answers for AI email replies (Jo 29 Oct 2026, AI answers list, Q6). Server (service role) only.
CREATE TABLE IF NOT EXISTS public.ai_reply_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  answer text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid NULL
);
REVOKE ALL ON public.ai_reply_answers FROM anon, authenticated;
GRANT ALL ON public.ai_reply_answers TO service_role;
ALTER TABLE public.ai_reply_answers ENABLE ROW LEVEL SECURITY;
-- No policies: browsers and signed-in users can never read or write the answers.
