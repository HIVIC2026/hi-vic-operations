# Website owner jobs — grilling decisions (Jo, 28 Oct 2026)

Findings only; nothing changed. To be built later through spec + plan.

1. Turn on every approved text type that is switched off live (sms_message_switches missing keys = off):
   owner: ready_check_times_owner, ready_check_booked_owner, visit_tomorrow_owner, safety_check_booked_owner,
   quote_reminder, install_moved, visit_new_times, three_questions_reminder;
   partner: piesa_offer, owner_changed_visit, mitti_invite, swms_sign_link, piesa_times_reminder,
   installer_planning_notice, install_day_form_result, install_day_form_reminder.
2. One-off texts held by quiet hours (8pm–7am) are sent at 7am (today only job offers are).
3. An expired installation quote (14 days) closes the job on day 14 with one owner email.
4. That email has a "Send me a new quote" button: reopens the same job, new quote at today's rates, office presses Send.
5. Card (Stripe) allowed for the 10% install deposit; balance stays bank transfer only; no card fee shown.
6. Must-fix: `invoice_create_failed` (quote accepted, Xero invoice failed) shows nowhere — needs a Needs me row.
7. Housekeeping: docs/STATUS.md, HIV_WORKFLOW_SOURCE_OF_TRUTH.md and src/AGENTS.md describe retired rules
   (50% / 5% / instalments, booking hold, DRAFT flags now approved).

Live settings read 28 Oct (SELECT only): customer_comms_enabled on, payment_option_gate_enabled on,
auto_electrician_offers on, auto_installer_offers off, mitti_auto_quote_enabled off, mitti_pickup_auto_enabled on.
