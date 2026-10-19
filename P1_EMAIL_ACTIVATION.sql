-- =============================================================================
-- P1 — PRODUCTION EMAIL AUTOMATION ACTIVATION
-- Home Insulation Victoria  ·  Supabase project: wvuffpykgnqliikhodzl
-- Prepared: 2026-10-19  ·  Authorised by: owner (production release instruction)
-- -----------------------------------------------------------------------------
-- WHAT THIS DOES
--   1. Turns ON the customer-communications MASTER switch (workflow_settings.customer_comms_enabled).
--   2. Turns ON the automatic workflow switches (quotes, installer/REC offers, Mitti).
--   3. Sets offer dispatch to 'automatic' so partner offers actually go out.
--   4. Enables the Base44 delivery bridge (customer_delivery_settings.enabled) used by the
--      estimate / eligibility / follow-up / quote / booking / completion email paths.
--   5. Sets customer_delivery_settings.jobs_created_after = go-live date. THIS IS REQUIRED:
--      with it NULL every customer email is suppressed ("backlog_cutoff_not_set"). Setting it
--      to the go-live date means ONLY jobs created on/after go-live are eligible — the
--      historical backlog is protected automatically (no bulk send on enablement).
--   6. Records a config-change audit event (owner-authorised; NOT attributed to Jo or any client).
--
-- WHAT THIS DOES NOT DO (safety — verified against source)
--   - Edits NO customer, owner, partner, job, or approval record.
--   - Fabricates NO approval attestation. Historical approval records are untouched.
--   - Bulk-sends NO historical backlog. Every send is trigger-driven:
--       · Estimate / eligibility / follow-up / quote / booking / completion  -> followups.server (real jobs only, qa_test excluded, 14-day max age, stage gate, consent, opt-out, idempotency).
--       · Save My Spot / Insulation Details campaigns                        -> hot-leads-send (real jobs only, qa_test excluded, consent + opt-out + once-per-home).
--       · Partner offers / invitations                                       -> offer-dispatch + trade-access (real jobs only).
--     No cron / pg_cron / backfill job exists that would mass-mail on enablement.
--   - Does NOT set the Resend connector secrets (RESEND_API_KEY / LOVABLE_API_KEY). Those are
--     Lovable cloud secrets and must be enabled separately in the Lovable dashboard (see notes).
--
-- PREREQUISITE (separate from this file — you hold the secret)
--   The Base44 bridge only works if customer_delivery_settings already has:
--       provider = 'base44_bridge', an https endpoint_url, and an hmac_secret >= 32 chars.
--   If any are blank, set them first, then re-run step 2 (the WHERE guards it).
--   The Save-My-Spot / Insulation-Details paths instead use Resend (RESEND_API_KEY +
--   LOVABLE_API_KEY Lovable secrets) and need the Resend connector connected in Lovable.
--
-- CODE NOTE: all per-template approval constants are ALREADY true in the working source
--   (SAVE_SPOT_REAL_SEND_APPROVED, INSULATION_DETAILS_REAL_SEND_APPROVED, LAUNCH_COPY_APPROVED),
--   so NO code change is needed for template authorisation — activation is configuration only.
--   Ensure the deployed build matches the approved working copy (deploy-source sync).
-- =============================================================================

-- 0) Inspect current state BEFORE changing anything (re-run after to confirm).
SELECT id, customer_comms_enabled, auto_send_quote, auto_send_installer,
       auto_send_rec, auto_send_mitti, offer_dispatch_mode
FROM workflow_settings WHERE id = 1;

SELECT id, provider, enabled, jobs_created_after,
       CASE WHEN endpoint_url IS NULL OR endpoint_url = '' THEN 'MISSING' ELSE 'set' END        AS endpoint,
       CASE WHEN hmac_secret IS NULL OR length(hmac_secret) < 32 THEN 'MISSING/short' ELSE 'set' END AS secret
FROM customer_delivery_settings WHERE id = 1;

-- 1) MASTER SWITCH + automatic workflow switches (workflow_settings, id = 1)
UPDATE workflow_settings
SET customer_comms_enabled = true,
    auto_send_quote        = true,           -- measured quote auto-release + external send
    auto_send_installer    = true,           -- installer offer auto-dispatch (partner comms)
    auto_send_rec          = true,           -- REC/electrician offer auto-dispatch (partner comms)
    auto_send_mitti        = true,           -- Mitti booking/forms comms auto-send (trades)
    offer_dispatch_mode    = 'automatic'      -- 'office_picks' otherwise pauses automatic partner offers
WHERE id = 1;

-- 2) DELIVERY ADAPTER — Base44 bridge (customer_delivery_settings, id = 1)
--    Config guard ensures we never "enable" a broken bridge. Fix provider/endpoint/secret first if blocked.
UPDATE customer_delivery_settings
SET enabled           = true,
    jobs_created_after = '2026-10-19T00:00:00+00:00'   -- go-live cutoff: protects historical backlog
WHERE id = 1
  AND provider = 'base44_bridge'
  AND endpoint_url IS NOT NULL AND endpoint_url <> ''
  AND hmac_secret IS NOT NULL AND length(hmac_secret) >= 32;

-- 3) AUDIT — record the owner-authorised activation as a NEW config event.
--    Replace NULL with the owner's auth user id if admin_config_events.actor_id is NOT NULL,
--    or drop the actor_id column if your schema allows NULL. This does NOT alter or imply any
--    historical client approval, and attributes nothing to Jo.
INSERT INTO admin_config_events (actor_id, event_type, summary, details)
VALUES (
  NULL,                                            -- <OWNER_USER_ID> if required
  'production_email_activation',
  'Owner-authorised full production email automation activation (2026-10-19): master switch ON, auto-send workflows ON, Base44 delivery bridge ON with go-live backlog cutoff.',
  jsonb_build_object(
    'authorised_by', 'owner_production_release_instruction_2026-10-19',
    'changes', jsonb_build_array(
      'workflow_settings.customer_comms_enabled = true',
      'workflow_settings.auto_send_quote = true',
      'workflow_settings.auto_send_installer = true',
      'workflow_settings.auto_send_rec = true',
      'workflow_settings.auto_send_mitti = true',
      'workflow_settings.offer_dispatch_mode = automatic',
      'customer_delivery_settings.enabled = true',
      'customer_delivery_settings.jobs_created_after = 2026-10-19 (backlog cutoff)'
    ),
    'note', 'Historical template-approval records unchanged. No approval attributed to Jo or any client. Resend connector (RESEND_API_KEY/LOVABLE_API_KEY) enabled separately in Lovable.'
  )
);

-- 4) Confirm the new state.
SELECT id, customer_comms_enabled, auto_send_quote, auto_send_installer,
       auto_send_rec, auto_send_mitti, offer_dispatch_mode
FROM workflow_settings WHERE id = 1;
SELECT id, provider, enabled, jobs_created_after FROM customer_delivery_settings WHERE id = 1;
