-- Jo 7 Oct 6pm: installer-supplied customers get a secure link to choose Ready Check times (no estimate).
ALTER TABLE public.customer_estimate_links DROP CONSTRAINT customer_estimate_links_purpose_check;
ALTER TABLE public.customer_estimate_links ADD CONSTRAINT customer_estimate_links_purpose_check CHECK (purpose IN ('step3_estimate', 'ready_check_times'));