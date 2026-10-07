ALTER TABLE public.customer_estimate_links DROP CONSTRAINT customer_estimate_links_purpose_check;
ALTER TABLE public.customer_estimate_links ADD CONSTRAINT customer_estimate_links_purpose_check CHECK (purpose = 'step3_estimate');
