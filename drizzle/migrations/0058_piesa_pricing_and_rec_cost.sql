-- PIESA pricing model (locked by Jo, 2026-09-30):
--   * Electrical rectification / upgrades pass through at the REC's agreed rate card (no markup).
--   * PIESA (Accredited Person fee) is charged to the owner at $349 inc GST and the REC is paid a
--     lower negotiated set rate. The negotiated REC rate is recorded in pricing_settings and is a
--     HI VIC cost in the markup/profit maths. It is intentionally NOT seeded — the office records
--     the negotiated figure; nothing is invented.
--   * A per-VEEC lodgement fee (registry cost) is also recorded here and deducted from HI VIC
--     profit per VEEC once set. Left unseeded until the exact figure is confirmed.
-- Also raises the previously test-only AP fee ($150 ex GST) to the real charge: $349 inc GST.
alter table public.pricing_settings add column if not exists piesa_rec_cost_ex_gst numeric(12, 2);
alter table public.pricing_settings add column if not exists veec_lodgement_fee_ex_gst numeric(12, 2);

update public.pricing_settings
set ap_fee_ex_gst = 317.27
where is_active = true;

insert into public.admin_config_events (actor_id, event_type, summary, details)
select null, 'pricing_update',
       'PIESA (AP fee) set to $349 inc GST; negotiated REC PIESA rate and per-VEEC lodgement fee left unrecorded until agreed',
       jsonb_build_object('pricing_settings_id', ps.id, 'ap_fee_ex_gst', ps.ap_fee_ex_gst, 'piesa_rec_cost_ex_gst', ps.piesa_rec_cost_ex_gst, 'veec_lodgement_fee_ex_gst', ps.veec_lodgement_fee_ex_gst)
from public.pricing_settings ps
where ps.is_active = true;
