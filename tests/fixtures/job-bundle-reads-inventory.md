# Installer job page bundle: read inventory (before Task 11)

Generated from `tests/job-bundle-waves.test.ts` with `SHOW_READS=1 SHOW_STACK=1` on commit cbe14bfa (after Task 6).
Each line: count, table | selected columns | filters @ source file:line. Job ids shortened (01 = J1, b1 = installer business, u1 = boss).
`rpc:sb:*` = signed-in client calls (sign-in and access checks); they are counted as round trips.

## installer boss, owner's own job (J1): 4 waves, 130 reads (sign-in client calls: getUser,my_job_role,is_admin,can_access_job,has_role)

Per table: workflow_events 27, bookings 14, jobs 11, job_assignments 10, quotes 7, business_members 4, ceiling_measurements 4, partner_workers 4, admin_config_events 3, appointment_proposals 3, assessments 3, businesses 3, installer_declarations 3, piesa_records 3, profiles 3, customer_assignments 2, invoices 2, partner_activations 2, rate_card_items 2, rate_cards 2, rectification_items 2, assessment_payments 1, job_overview 1, job_piesa_deadlines 1, partner_offers 1, payment_overrides 1, properties 1, ready_check_windows 1, rpc:has_contact_release 1, rpc:sb:can_access_job 1, rpc:sb:getUser 1, rpc:sb:has_role 1, rpc:sb:is_admin 1, rpc:sb:my_job_role 1, user_roles 1, worker_job_links 1, workflow_settings 1

```
2x admin_config_events | details | eq event_type "esc_collection_notice_acknowledged" @ esc-collection-notice.server.ts:21 < piisa-a3.server.ts:26
1x admin_config_events | id, details | eq event_type "installer_usual_electrician_saved" contains details {"business_id":b1} @ usual-electrician.server.ts:8 < installer-price-set.server.ts:117
1x appointment_proposals | id, proposer_role, starts_at, ends_at, status | eq job_id 01 eq install_day true @ install-days.server.ts:28 < install-days.server.ts:69
1x appointment_proposals | id, proposer_role, starts_at, status | eq job_id 01 eq kind "ready_check" eq note "ready_check_time" @ ready-check-times.server.ts:23 < ready-check-times.server.ts:212
1x appointment_proposals | job_id, kind, created_at, proposer_role | in job_id [01] eq kind "assessment" eq proposer_role "owner" @ job-status.server.ts:30 < mitti-job-presentation.server.ts:20
1x assessment_payments | job_id, paid_at | in job_id [01] eq status "paid" @ job-status.server.ts:32 < mitti-job-presentation.server.ts:20
1x assessments | job_id, external_mitti_id | in job_id [04,01] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:95
1x assessments | job_id, external_mitti_id, mitti_completed, mitti_raw_snapshot, mitti_synced_at, mitti_modified_at | in job_id [04,01] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:40
1x assessments | status, piesa_outcome, completed_at | eq job_id 01 @ trade-view.server.ts:1200
1x bookings | created_at | eq job_id 01 eq kind "installation" in status ["confirmed","completed"] @ piisa-a3.server.ts:46 < piisa-a3.server.ts:52
1x bookings | created_at | eq job_id 01 eq kind "installation" in status ["confirmed","completed"] @ visit-allocation.server.ts:45 < visit-allocation.server.ts:82
1x bookings | id, job_id, kind, scheduled_start, status, business_id, businesses(name, trading_name), jobs!inner(deleted_at, job_number, source, channel, stage, electrician_choice, originating_installer_business_id, owners(full_name), properties(suburb), assessments!assessments_job_id_fkey(mitti_com
2x bookings | id, job_id, kind, scheduled_start, status, business_id, businesses(name, trading_name), jobs!inner(deleted_at, job_number, source, channel, stage, electrician_choice, originating_installer_business_id, owners(full_name), properties(suburb), assessments!assessments_job_id_fkey(mitti_com
1x bookings | id, job_id, scheduled_start, business_id, status | in job_id [04,01] eq kind "assessment" in status ["confirmed","completed"] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:93
1x bookings | id, scheduled_start | eq job_id 01 eq kind "installation" eq status "confirmed" @ install-days.server.ts:27 < install-days.server.ts:69
1x bookings | id, scheduled_start | eq job_id 01 eq kind "ready_check" eq status "confirmed" @ ready-check-times.server.ts:22 < ready-check-times.server.ts:212
1x bookings | job_id, kind, status, scheduled_start, scheduled_end, business_id, businesses(name, trading_name) | in job_id [01] in status ["confirmed","completed"] @ job-status.server.ts:26 < mitti-job-presentation.server.ts:20
1x bookings | job_id, scheduled_start | in job_id [04,01] eq kind "installation" in status ["confirmed","completed"] @ install-evidence.server.ts:82 < trade-payout-gate.server.ts:38
1x bookings | scheduled_start | eq job_id 01 eq kind "assessment" in status ["confirmed","completed"] @ trade-view.server.ts:1211
1x bookings | scheduled_start, status | eq job_id 01 eq kind "installation" @ trade-view.server.ts:1184
1x bookings | scheduled_start, status | eq job_id 01 eq kind "ready_check" @ trade-view.server.ts:1197
1x bookings | status | eq job_id 01 eq kind "installation" @ trade-view.server.ts:1375
1x business_members | business_id, member_role | eq user_id u1 eq active true @ pilot.server.ts:24 < installer-price-set.server.ts:111
1x business_members | business_id, member_role | eq user_id u1 eq active true @ pilot.server.ts:24 < worker-links.server.ts:33
1x business_members | business_id, member_role, businesses(id, name, business_type, capabilities, base_suburb, coverage_radius_km, covers_all_victoria, accepting_new_jobs, onboarding_notes, mitti_account_invited) | eq user_id u1 eq active true @ trade-view.server.ts:67 < trade-view.server.ts:87
1x business_members | user_id | eq business_id b1 eq user_id u1 @ job-overview.server.ts:26
1x businesses | email | eq id b1 @ visit-allocation.server.ts:22 < visit-allocation.server.ts:80
1x businesses | id,name,in_house,pays_own_electricians | in id [b1] @ installer-paid-electricians.server.ts:16 < installer-paid-electricians.server.ts:45
1x businesses | id,name,in_house,pays_own_electricians | in id [b1] @ installer-paid-electricians.server.ts:16 < installer-paid-electricians.server.ts:95
1x ceiling_measurements | external_source,external_id | eq job_id 01 eq is_current true @ installer-quote-status.server.ts:23 < job-shared-reads.ts:31
1x ceiling_measurements | external_source,external_id | eq job_id 01 eq is_current true @ mitti-job-presentation.server.ts:10
1x ceiling_measurements | measured_area_m2, removal_m2, removal_required | eq job_id 01 eq is_current true @ trade-view.server.ts:1199
1x ceiling_measurements | raw_snapshot, removal_required, measured_area_m2 | eq job_id 01 eq is_current true @ installer-price-set.server.ts:71 < installer-price-set.server.ts:124
1x customer_assignments | installer_signed_at | eq job_id 01 eq record_kind "final_veec_assignment" @ trade-view.server.ts:1154 < trade-view.server.ts:1201
1x customer_assignments | installer_signed_at, consumer_final_signed_at, ap_signed_at, installed_product, installed_area_m2 | eq job_id 01 eq record_kind "final_veec_assignment" @ trade-view.server.ts:1217
1x installer_declarations | id | eq job_id 01 eq status "signed" @ trade-view.server.ts:1147 < trade-view.server.ts:1204
1x installer_declarations | installer_name, signed_at, installed_product, installed_area_m2 | eq job_id 01 eq status "signed" @ trade-view.server.ts:1216
1x installer_declarations | job_id | in job_id [04,01] eq status "signed" @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:42
1x invoices | id, job_id, kind, status, deposit_paid_at, balance_paid_at, paid_at, total_paid, deposit_paid_amount, deposit_amount, created_at | in job_id [01] @ job-status.server.ts:29 < mitti-job-presentation.server.ts:20
1x invoices | job_id, kind, status, balance_paid_at, paid_at, updated_at | in job_id [04,01] eq kind "installation" @ trade-view.server.ts:559
1x job_assignments | business_id | eq job_id 01 eq active true @ worker-links.server.ts:22
1x job_assignments | business_id | eq job_id 01 eq role "installer" eq active true @ piisa-a3.server.ts:12 < piisa-a3.server.ts:52
1x job_assignments | id, user_id, business_id | eq job_id 01 eq role "installer" eq active true @ install-days.server.ts:26 < install-days.server.ts:69
1x job_assignments | id, user_id, business_id | eq job_id 01 eq role "installer" eq active true @ install-days.server.ts:57 < install-days.server.ts:69
1x job_assignments | id, user_id, business_id | eq job_id 01 eq role "installer" eq active true @ ready-check-times.server.ts:21 < ready-check-times.server.ts:212
1x job_assignments | id, user_id, business_id | eq job_id 01 eq role "installer" eq active true @ ready-check-times.server.ts:58 < ready-check-times.server.ts:212
1x job_assignments | job_id, business_id, businesses(in_house) | eq role "installer" eq active true in job_id [01] @ in-house-suppression.server.ts:18 < in-house-suppression.server.ts:41
1x job_assignments | job_id, business_id, businesses(in_house) | eq role "installer" eq active true in job_id [01] @ in-house-suppression.server.ts:18 < job-status.server.ts:24
1x job_assignments | job_id, business_id, user_id, active | eq job_id 01 eq active true @ trade-view.server.ts:395 < trade-view.server.ts:388
1x job_assignments | profiles:user_id(full_name) | eq job_id 01 eq role "electrician" eq active true @ trade-view.server.ts:1212
1x job_overview | * | eq id 01 @ job-overview.server.ts:21 < trade-job-bundle.server.ts:105
1x job_piesa_deadlines | * | eq job_id 01 @ workflow.server.ts:131 < install-days.server.ts:25
1x jobs | channel | eq id 01 @ installer-quote-status.server.ts:21 < job-shared-reads.ts:31
1x jobs | channel, originating_installer_business_id, properties(address_line,suburb,state,postcode) | eq id 01 @ installer-price-set.server.ts:104 < trade-job-bundle.server.ts:131
1x jobs | id, installation_completed_at | in id [04,01] @ install-evidence.server.ts:83 < trade-payout-gate.server.ts:38
1x jobs | id, job_number, stage, channel, originating_installer_business_id, created_at | in id [01] @ job-status.server.ts:25 < mitti-job-presentation.server.ts:20
1x jobs | id, stage, channel, source, deleted_at | eq id 01 @ ready-check-times.server.ts:20 < ready-check-times.server.ts:212
1x jobs | installation_completed_at | eq id 01 @ trade-view.server.ts:1374
1x jobs | job_number, stage, channel, next_action, installation_completed_at | eq id 01 @ trade-view.server.ts:1183
1x jobs | next_action, channel | eq id 01 @ mitti-job-presentation.server.ts:11
1x jobs | originating_installer_business_id, cancelled_reason | eq id 01 @ job-overview.server.ts:25 < trade-job-bundle.server.ts:105
1x jobs | stage | eq id 01 @ visit-allocation.server.ts:73
1x jobs | stage, install_10day_flagged_at | eq id 01 @ install-days.server.ts:23 < install-days.server.ts:69
2x partner_activations | application_id, business_id | in business_id [b1] @ esc-collection-notice.server.ts:22 < piisa-a3.server.ts:26
1x partner_offers | job_id, kind, summary | eq business_id b1 eq status "accepted" in job_id [04,01] @ trade-view.server.ts:557
2x partner_workers | id, business_id, email, full_legal_name, certification, approval_status, removed_at, trade_role, worker_role, licence_expires_on, declarations_due | eq business_id b1 eq trade_role "installer" @ piisa-a3.server.ts:21 < piisa-a3.server.ts:27
1x partner_workers | id, business_id, full_legal_name, email, mobile, trade_role, licence_number, qualification, approval_status, approved_at, rejection_reason, removed_at, created_at, certification_status, certification, worker_role, profile_id, businesses(name) | in business_id [b1] @ worker-links
1x partner_workers | id, full_legal_name, trade_role, email, mobile, removed_at, worker_role, declarations_due | eq business_id b1 @ visit-allocation.server.ts:19 < visit-allocation.server.ts:24
1x payment_overrides | job_id, invoice_id | in job_id [01] eq gate "deposit" @ job-status.server.ts:36 < mitti-job-presentation.server.ts:20
1x piesa_records | job_id, created_at, external_mitti_id | in job_id [04,01] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:94
1x piesa_records | outcome, completed_date, signed_off_by | eq job_id 01 in kind ["initial","reassessment"] @ electrical-clearance.server.ts:49 < trade-job-bundle.server.ts:117
1x piesa_records | rectification_completed_at, section_c_signed_at, outcome | eq job_id 01 eq is_current true @ electrical-clearance.server.ts:50 < trade-job-bundle.server.ts:117
1x profiles | business_id | eq id u1 @ pilot.server.ts:23 < installer-price-set.server.ts:111
1x profiles | business_id | eq id u1 @ pilot.server.ts:23 < worker-links.server.ts:33
1x profiles | full_name, phone, email | eq id u1 @ trade-view.server.ts:69 < trade-view.server.ts:87
1x properties | suburb, postcode | eq id "p1" @ job-overview.server.ts:28
1x quotes | id, job_id, status, sent_at, release_state, release_hold_reason, option_code, created_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, quote_items(code, description, explanation, quantity, unit, unit_price_inc_gst, line_total_inc_gst, sort) | eq job_id 01 eq kind "ins
1x quotes | id, status, created_at, quote_internals(cost_ex_gst) | eq job_id 01 eq kind "installation" in status ["draft","issued","accepted"] @ trade-view.server.ts:1136 < trade-view.server.ts:1203
1x quotes | job_id, kind, quote_items(code, description), quote_internals(cost_ex_gst) | in job_id [04,01] eq status "accepted" @ trade-view.server.ts:561
1x quotes | job_id, kind, status, sent_at, accepted_at | in job_id [01] in status ["issued","accepted"] @ job-status.server.ts:28 < mitti-job-presentation.server.ts:20
1x quotes | job_id,quote_items(code,line_total_inc_gst) | in job_id [01] eq kind "installation" in status ["accepted","issued"] @ installer-paid-electricians.server.ts:96 < installer-paid-electricians.server.ts:96
1x quotes | sent_at | eq job_id 01 eq kind "installation" @ installer-price-set.server.ts:31 < installer-price-set.server.ts:134
1x quotes | status | eq job_id 01 eq kind "rectification" in status ["issued","accepted"] @ electrical-clearance.server.ts:51 < trade-job-bundle.server.ts:117
1x rate_card_items | rate_card_id,code,unit_price_ex_gst,rate_cards!inner(business_id) | in rate_cards.business_id [b1] eq rate_cards.is_active true @ installer-paid-electricians.server.ts:27 < installer-paid-electricians.server.ts:45
1x rate_card_items | rate_card_id,code,unit_price_ex_gst,rate_cards!inner(business_id) | in rate_cards.business_id [b1] eq rate_cards.is_active true @ installer-paid-electricians.server.ts:27 < installer-paid-electricians.server.ts:98
1x rate_cards | id,business_id,version,effective_from | in business_id [b1] eq is_active true @ installer-paid-electricians.server.ts:25 < installer-paid-electricians.server.ts:45
1x rate_cards | id,business_id,version,effective_from | in business_id [b1] eq is_active true @ installer-paid-electricians.server.ts:25 < installer-paid-electricians.server.ts:98
1x ready_check_windows | job_id, created_at | in job_id [01] @ job-status.server.ts:37 < mitti-job-presentation.server.ts:20
1x rectification_items | description, status | eq job_id 01 @ trade-view.server.ts:1213
1x rectification_items | id | eq job_id 01 @ electrical-clearance.server.ts:52 < trade-job-bundle.server.ts:117
1x rpc:has_contact_release |  |
1x rpc:sb:can_access_job |  |
1x rpc:sb:getUser |  |
1x rpc:sb:has_role |  |
1x rpc:sb:is_admin |  |
1x rpc:sb:my_job_role |  |
1x user_roles | role | eq user_id u1 @ trade-view.server.ts:68 < trade-view.server.ts:87
1x worker_job_links | id, worker_id, business_id, created_at, expires_at, revoked_at, last_opened_at, open_count, partner_workers(full_legal_name, trade_role) | eq job_id 01 in business_id [b1] @ worker-links.server.ts:42
1x workflow_events | created_at | eq job_id 01 eq event_type "new_quote_requested" @ installer-price.server.ts:39 < installer-price-set.server.ts:112
1x workflow_events | created_at | eq job_id 01 eq event_type "new_quote_requested" @ installer-price.server.ts:39 < installer-price.server.ts:67
1x workflow_events | created_at | eq job_id 01 eq event_type "quote_declined" @ trade-view.server.ts:1209
1x workflow_events | created_at | eq job_id 01 eq event_type "ready_check_basics" contains details {"completed":true} @ trade-view.server.ts:1210
1x workflow_events | details | eq job_id 01 eq event_type "electrician_choice_set" @ electrician-choice.server.ts:10 < installer-price-set.server.ts:122
1x workflow_events | details | eq job_id 01 eq event_type "mitti_electrician_recorded" @ mitti-job-presentation.server.ts:12
1x workflow_events | details | eq job_id 01 eq event_type "mitti_piisa_audit_created" @ trade-view.server.ts:1146 < trade-view.server.ts:1204
1x workflow_events | details | eq job_id 01 eq event_type "mitti_piisa_audit_created" @ visit-allocation.server.ts:57 < visit-allocation.server.ts:83
1x workflow_events | details | eq job_id 01 eq event_type "piisa_crew_selected" @ piisa-a3.server.ts:58 < trade-job-bundle.server.ts:154
1x workflow_events | details | eq job_id 01 eq event_type "ready_check_basics" @ installer-quote-status.server.ts:24 < job-shared-reads.ts:31
1x workflow_events | details | eq job_id 01 eq event_type "ready_check_basics" @ mitti-job-presentation.server.ts:13
1x workflow_events | details, created_at | eq job_id 01 eq event_type "install_evidence_synced" @ trade-view.server.ts:1214
1x workflow_events | details, created_at | eq job_id 01 eq event_type "installer_note" @ ai-email-reply.server.ts:173 < trade-view.server.ts:1220
1x workflow_events | details, created_at, actor_id | eq job_id 01 eq event_type "installer_price_set" @ installer-price.server.ts:31 < installer-price-set.server.ts:112
1x workflow_events | details, created_at, actor_id | eq job_id 01 eq event_type "installer_price_set" @ installer-price.server.ts:31 < installer-price.server.ts:67
1x workflow_events | event_type, details, created_at | eq job_id 01 eq event_type "visit_allocated" @ trade-view.server.ts:1215
1x workflow_events | event_type, details, created_at | eq job_id 01 eq event_type "visit_allocated" @ visit-allocation.server.ts:50 < visit-allocation.server.ts:79
1x workflow_events | event_type, summary | eq job_id 01 in event_type ["mitti_access_needed","mitti_audit_created","mitti_audit_reshared"] @ worker-links.server.ts:34 < trade-job-bundle.server.ts:122
1x workflow_events | job_id, created_at | eq event_type "stage_changed" eq to_stage "ready_for_veec" in job_id [04,01] @ trade-view.server.ts:556
1x workflow_events | job_id, created_at, details | eq event_type "payout_marked_paid" in job_id [04,01] @ trade-view.server.ts:555
1x workflow_events | job_id, details | in job_id [01] in event_type ["qa_payment_simulated","payment_simulated"] @ job-status.server.ts:34 < mitti-job-presentation.server.ts:20
1x workflow_events | job_id, details, created_at | in job_id [04,01] eq event_type "electrician_form_approved" @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:45
1x workflow_events | job_id, details, created_at | in job_id [04,01] eq event_type "electrician_form_approved" @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:96
1x workflow_events | job_id, details, created_at | in job_id [04,01] eq event_type "install_evidence_synced" @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:43
1x workflow_events | job_id, event_type, created_at, details | eq job_id 01 in event_type ["electrician_install_attendance_declined","electrician_install_attendance_confirmed"] @ install-days.server.ts:15 < install-days.server.ts:34
1x workflow_events | job_id, event_type, created_at, summary, details | in job_id [04,01] in event_type ["fixes_form_created","fixes_form_completed","fixes_form_not_done","fixes_form_held"] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:41
1x workflow_events | job_id, event_type, to_stage, created_at | in job_id [01] in event_type ["stage_changed","payout_marked_paid","installer_ready_check_times_delivery","ready_check_more_times_requested"] @ job-status.server.ts:27 < mitti-job-presentation.server.ts:20
1x workflow_settings | due_trade_reply_warn_hours, due_trade_reply_exception_hours, due_owner_reminder_days, due_owner_flag_days | eq id 1 @ job-status.server.ts:31 < mitti-job-presentation.server.ts:20
```

## installer boss, other job, booked (J4 complete): 4 waves, 116 reads (sign-in client calls: getUser,my_job_role,is_admin,can_access_job,has_role)

Per table: workflow_events 23, bookings 13, jobs 11, job_assignments 10, quotes 6, ceiling_measurements 5, assessments 4, piesa_records 4, business_members 3, businesses 3, installer_declarations 3, partner_workers 3, profiles 3, appointment_proposals 2, customer_assignments 2, rate_card_items 2, rate_cards 2, rectification_items 2, admin_config_events 1, invoices 1, job_overview 1, job_piesa_deadlines 1, partner_activations 1, partner_offers 1, properties 1, rpc:has_contact_release 1, rpc:sb:can_access_job 1, rpc:sb:getUser 1, rpc:sb:has_role 1, rpc:sb:is_admin 1, rpc:sb:my_job_role 1, user_roles 1, worker_job_links 1

## installer boss, job assigned to their staff (J2): 4 waves, 152 reads (sign-in client calls: getUser,my_job_role,is_admin,can_access_job,has_role)

Per table: workflow_events 27, bookings 18, jobs 14, job_assignments 12, quotes 8, piesa_records 7, partner_workers 6, business_members 5, ceiling_measurements 5, assessments 4, businesses 4, admin_config_events 3, appointment_proposals 3, installer_declarations 3, partner_activations 3, profiles 3, rectification_items 3, customer_assignments 2, invoices 2, job_piesa_deadlines 2, rate_card_items 2, rate_cards 2, workflow_settings 2, job_overview 1, owner_esc_consents 1, partner_offers 1, properties 1, rpc:has_contact_release 1, rpc:sb:can_access_job 1, rpc:sb:getUser 1, rpc:sb:has_role 1, rpc:sb:is_admin 1, rpc:sb:my_job_role 1, user_roles 1, worker_job_links 1

```
3x admin_config_events | details | eq event_type "esc_collection_notice_acknowledged" @ esc-collection-notice.server.ts:21 < piisa-a3.server.ts:26
1x appointment_proposals | id, proposer_role, starts_at, ends_at, status | eq job_id 02 eq install_day true @ install-days.server.ts:28 < install-days.server.ts:69
1x appointment_proposals | id, proposer_role, starts_at, ends_at, status | eq job_id 02 eq install_day true @ install-days.server.ts:28
1x appointment_proposals | id, proposer_role, starts_at, status | eq job_id 02 eq kind "ready_check" eq note "ready_check_time" @ ready-check-times.server.ts:23 < ready-check-times.server.ts:212
1x assessments | hazards, piesa_outcome | eq job_id 02 @ swms.server.ts:47 < swms.server.ts:84
1x assessments | job_id, external_mitti_id | in job_id [04,01] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:95
1x assessments | job_id, external_mitti_id, mitti_completed, mitti_raw_snapshot, mitti_synced_at, mitti_modified_at | in job_id [04,01] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:40
1x assessments | status, piesa_outcome, completed_at | eq job_id 02 @ trade-view.server.ts:1200
2x bookings | created_at | eq job_id 02 eq kind "installation" in status ["confirmed","completed"] @ piisa-a3.server.ts:46 < piisa-a3.server.ts:52
1x bookings | created_at | eq job_id 02 eq kind "installation" in status ["confirmed","completed"] @ visit-allocation.server.ts:45 < visit-allocation.server.ts:82
1x bookings | id, created_at, scheduled_start | eq job_id 02 eq kind "installation" eq status "confirmed" @ payments.server.ts:193 < trade-view.server.ts:1166
1x bookings | id, job_id, kind, scheduled_start, status, business_id, businesses(name, trading_name), jobs!inner(deleted_at, job_number, source, channel, stage, electrician_choice, originating_installer_business_id, owners(full_name), properties(suburb), assessments!assessments_job_id_fkey(mitti_com
2x bookings | id, job_id, kind, scheduled_start, status, business_id, businesses(name, trading_name), jobs!inner(deleted_at, job_number, source, channel, stage, electrician_choice, originating_installer_business_id, owners(full_name), properties(suburb), assessments!assessments_job_id_fkey(mitti_com
1x bookings | id, job_id, scheduled_start, business_id, status | in job_id [04,01] eq kind "assessment" in status ["confirmed","completed"] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:93
1x bookings | id, scheduled_start | eq job_id 02 eq kind "installation" eq status "completed" @ payments.server.ts:194 < trade-view.server.ts:1166
1x bookings | id, scheduled_start | eq job_id 02 eq kind "installation" eq status "confirmed" @ install-days.server.ts:27 < install-days.server.ts:69
1x bookings | id, scheduled_start | eq job_id 02 eq kind "installation" eq status "confirmed" @ install-days.server.ts:27
1x bookings | id, scheduled_start | eq job_id 02 eq kind "ready_check" eq status "confirmed" @ ready-check-times.server.ts:22 < ready-check-times.server.ts:212
1x bookings | job_id, scheduled_start | in job_id [04,01] eq kind "installation" in status ["confirmed","completed"] @ install-evidence.server.ts:82 < trade-payout-gate.server.ts:38
1x bookings | scheduled_start | eq job_id 02 eq kind "assessment" in status ["confirmed","completed"] @ trade-view.server.ts:1211
1x bookings | scheduled_start | eq job_id 02 eq kind "installation" @ swms.server.ts:46 < swms.server.ts:84
1x bookings | scheduled_start, status | eq job_id 02 eq kind "installation" @ trade-view.server.ts:1184
1x bookings | scheduled_start, status | eq job_id 02 eq kind "ready_check" @ trade-view.server.ts:1197
1x bookings | status | eq job_id 02 eq kind "installation" @ trade-view.server.ts:1375
1x business_members | business_id, member_role | eq user_id u1 eq active true @ pilot.server.ts:24 < installer-price-set.server.ts:111
1x business_members | business_id, member_role | eq user_id u1 eq active true @ pilot.server.ts:24 < worker-links.server.ts:33
1x business_members | business_id, member_role, businesses(id, name, business_type, capabilities, base_suburb, coverage_radius_km, covers_all_victoria, accepting_new_jobs, onboarding_notes, mitti_account_invited) | eq user_id u1 eq active true @ trade-view.server.ts:67 < trade-view.server.ts:87
1x business_members | id | eq business_id b1 eq user_id u1 eq active true @ install-days.server.ts:60 < install-days.server.ts:69
1x business_members | id | eq business_id b1 eq user_id u1 eq active true @ ready-check-times.server.ts:61 < ready-check-times.server.ts:212
1x businesses | email | eq id b1 @ visit-allocation.server.ts:22 < visit-allocation.server.ts:80
1x businesses | id,name,in_house,pays_own_electricians | in id [b1] @ installer-paid-electricians.server.ts:16 < installer-paid-electricians.server.ts:45
1x businesses | id,name,in_house,pays_own_electricians | in id [b1] @ installer-paid-electricians.server.ts:16 < installer-paid-electricians.server.ts:95
1x businesses | name | eq id b1 @ swms.server.ts:42
1x ceiling_measurements | external_source,external_id | eq job_id 02 eq is_current true @ installer-quote-status.server.ts:23 < job-shared-reads.ts:31
1x ceiling_measurements | external_source,external_id | eq job_id 02 eq is_current true @ mitti-job-presentation.server.ts:10
1x ceiling_measurements | measured_area_m2, removal_m2, removal_required | eq job_id 02 eq is_current true @ trade-view.server.ts:1199
1x ceiling_measurements | raw_snapshot | eq job_id 02 eq is_current true @ swms.server.ts:51 < swms.server.ts:84
1x ceiling_measurements | raw_snapshot, removal_required, measured_area_m2 | eq job_id 02 eq is_current true @ installer-price-set.server.ts:71 < installer-price-set.server.ts:124
1x customer_assignments | installer_signed_at | eq job_id 02 eq record_kind "final_veec_assignment" @ trade-view.server.ts:1154 < trade-view.server.ts:1201
1x customer_assignments | installer_signed_at, consumer_final_signed_at, ap_signed_at, installed_product, installed_area_m2 | eq job_id 02 eq record_kind "final_veec_assignment" @ trade-view.server.ts:1217
1x installer_declarations | id | eq job_id 02 eq status "signed" @ trade-view.server.ts:1147 < trade-view.server.ts:1204
1x installer_declarations | installer_name, signed_at, installed_product, installed_area_m2 | eq job_id 02 eq status "signed" @ trade-view.server.ts:1216
1x installer_declarations | job_id | in job_id [04,01] eq status "signed" @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:42
1x invoices | id, kind, quote_id, repeat_key, total_inc_gst, total_paid, deposit_amount, xero_invoice_number, xero_reference, xero_online_url, xero_invoice_id, balance_due_date, quotes(accepted_at, customer_total_inc_gst) | eq job_id 02 eq kind "installation" @ payments.server.ts:190 < trade-view.se
1x invoices | job_id, kind, status, balance_paid_at, paid_at, updated_at | in job_id [04,01] eq kind "installation" @ trade-view.server.ts:559
1x job_assignments | business_id | eq job_id 02 eq active true @ worker-links.server.ts:22
2x job_assignments | business_id | eq job_id 02 eq role "installer" eq active true @ piisa-a3.server.ts:12 < piisa-a3.server.ts:52
1x job_assignments | business_id | eq job_id 02 eq role "installer" eq active true @ swms.server.ts:41 < swms.server.ts:84
1x job_assignments | id, user_id, business_id | eq job_id 02 eq role "installer" eq active true @ install-days.server.ts:26 < install-days.server.ts:69
1x job_assignments | id, user_id, business_id | eq job_id 02 eq role "installer" eq active true @ install-days.server.ts:26
1x job_assignments | id, user_id, business_id | eq job_id 02 eq role "installer" eq active true @ install-days.server.ts:57 < install-days.server.ts:69
1x job_assignments | id, user_id, business_id | eq job_id 02 eq role "installer" eq active true @ ready-check-times.server.ts:21 < ready-check-times.server.ts:212
1x job_assignments | id, user_id, business_id | eq job_id 02 eq role "installer" eq active true @ ready-check-times.server.ts:58 < ready-check-times.server.ts:212
1x job_assignments | job_id, business_id, businesses(in_house) | eq role "installer" eq active true in job_id [02] @ in-house-suppression.server.ts:18 < in-house-suppression.server.ts:41
1x job_assignments | job_id, business_id, user_id, active | eq job_id 02 eq active true @ trade-view.server.ts:395 < trade-view.server.ts:388
1x job_assignments | profiles:user_id(full_name) | eq job_id 02 eq role "electrician" eq active true @ trade-view.server.ts:1212
1x job_overview | * | eq id 02 @ job-overview.server.ts:21 < trade-job-bundle.server.ts:105
2x job_piesa_deadlines | * | eq job_id 02 @ workflow.server.ts:131 < install-days.server.ts:25
1x jobs | channel | eq id 02 @ installer-quote-status.server.ts:21 < job-shared-reads.ts:31
1x jobs | channel, originating_installer_business_id, properties(address_line,suburb,state,postcode) | eq id 02 @ installer-price-set.server.ts:104 < trade-job-bundle.server.ts:131
1x jobs | id, installation_completed_at | in id [04,01] @ install-evidence.server.ts:83 < trade-payout-gate.server.ts:38
1x jobs | id, stage, channel, source, deleted_at | eq id 02 @ ready-check-times.server.ts:20 < ready-check-times.server.ts:212
1x jobs | installation_completed_at | eq id 02 @ trade-view.server.ts:1374
1x jobs | job_number, life_support_status, properties(address_line, suburb, postcode, year_built) | eq id 02 @ swms.server.ts:44 < swms.server.ts:84
1x jobs | job_number, stage, channel, next_action, installation_completed_at | eq id 02 @ trade-view.server.ts:1183
1x jobs | job_number, stage, source, installation_completed_at | eq id 02 @ payments.server.ts:195 < trade-view.server.ts:1166
1x jobs | next_action, channel | eq id 02 @ mitti-job-presentation.server.ts:11
1x jobs | originating_installer_business_id, cancelled_reason | eq id 02 @ job-overview.server.ts:25 < trade-job-bundle.server.ts:105
1x jobs | source, qa_archived_at | eq id 02 @ workflow.server.ts:145
1x jobs | stage | eq id 02 @ visit-allocation.server.ts:73
1x jobs | stage, install_10day_flagged_at | eq id 02 @ install-days.server.ts:23 < install-days.server.ts:69
1x jobs | stage, install_10day_flagged_at | eq id 02 @ install-days.server.ts:23
1x owner_esc_consents | owner_signed_at | eq job_id 02 @ trade-view.server.ts:1164 < trade-view.server.ts:1187
3x partner_activations | application_id, business_id | in business_id [b1] @ esc-collection-notice.server.ts:22 < piisa-a3.server.ts:26
1x partner_offers | job_id, kind, summary | eq business_id b1 eq status "accepted" in job_id [04,01] @ trade-view.server.ts:557
1x partner_workers | id | eq business_id b1 eq profile_id u1 @ trade-view.server.ts:1384 < trade-view.server.ts:1379
3x partner_workers | id, business_id, email, full_legal_name, certification, approval_status, removed_at, trade_role, worker_role, licence_expires_on, declarations_due | eq business_id b1 eq trade_role "installer" @ piisa-a3.server.ts:21 < piisa-a3.server.ts:27
1x partner_workers | id, business_id, full_legal_name, email, mobile, trade_role, licence_number, qualification, approval_status, approved_at, rejection_reason, removed_at, created_at, certification_status, certification, worker_role, profile_id, businesses(name) | in business_id [b1] @ worker-links
1x partner_workers | id, full_legal_name, trade_role, email, mobile, removed_at, worker_role, declarations_due | eq business_id b1 @ visit-allocation.server.ts:19 < visit-allocation.server.ts:24
1x piesa_records | job_id, created_at, external_mitti_id | in job_id [04,01] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:94
1x piesa_records | outcome, completed_date, signed_off_by | eq job_id 02 in kind ["initial","reassessment"] @ electrical-clearance.server.ts:49 < install-days.server.ts:24
1x piesa_records | outcome, completed_date, signed_off_by | eq job_id 02 in kind ["initial","reassessment"] @ electrical-clearance.server.ts:49 < trade-job-bundle.server.ts:117
1x piesa_records | outcome, rectification_completed_at | eq job_id 02 eq is_current true @ swms.server.ts:52 < swms.server.ts:84
1x piesa_records | outcome, section_c_signed_at | eq job_id 02 eq is_current true @ payments.server.ts:196 < trade-view.server.ts:1166
1x piesa_records | rectification_completed_at, section_c_signed_at, outcome | eq job_id 02 eq is_current true @ electrical-clearance.server.ts:50 < install-days.server.ts:24
1x piesa_records | rectification_completed_at, section_c_signed_at, outcome | eq job_id 02 eq is_current true @ electrical-clearance.server.ts:50 < trade-job-bundle.server.ts:117
1x profiles | business_id | eq id u1 @ pilot.server.ts:23 < installer-price-set.server.ts:111
1x profiles | business_id | eq id u1 @ pilot.server.ts:23 < worker-links.server.ts:33
1x profiles | full_name, phone, email | eq id u1 @ trade-view.server.ts:69 < trade-view.server.ts:87
1x properties | suburb, postcode | eq id "p2" @ job-overview.server.ts:28
1x quotes | id, job_id, status, sent_at, release_state, release_hold_reason, option_code, created_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, quote_items(code, description, explanation, quantity, unit, unit_price_inc_gst, line_total_inc_gst, sort) | eq job_id 02 eq kind "ins
1x quotes | id, status, created_at, quote_internals(cost_ex_gst) | eq job_id 02 eq kind "installation" in status ["draft","issued","accepted"] @ trade-view.server.ts:1136 < trade-view.server.ts:1203
1x quotes | id, status, version, customer_total_inc_gst, accepted_at, created_at | eq job_id 02 eq kind "rectification" @ fixes-quote-current.server.ts:5 < payments.server.ts:192
1x quotes | job_id, kind, quote_items(code, description), quote_internals(cost_ex_gst) | in job_id [04,01] eq status "accepted" @ trade-view.server.ts:561
1x quotes | job_id,quote_items(code,line_total_inc_gst) | in job_id [01] eq kind "installation" in status ["accepted","issued"] @ installer-paid-electricians.server.ts:96 < installer-paid-electricians.server.ts:96
1x quotes | sent_at | eq job_id 02 eq kind "installation" @ installer-price-set.server.ts:31 < installer-price-set.server.ts:134
1x quotes | status | eq job_id 02 eq kind "rectification" in status ["issued","accepted"] @ electrical-clearance.server.ts:51 < install-days.server.ts:24
1x quotes | status | eq job_id 02 eq kind "rectification" in status ["issued","accepted"] @ electrical-clearance.server.ts:51 < trade-job-bundle.server.ts:117
1x rate_card_items | rate_card_id,code,unit_price_ex_gst,rate_cards!inner(business_id) | in rate_cards.business_id [b1] eq rate_cards.is_active true @ installer-paid-electricians.server.ts:27 < installer-paid-electricians.server.ts:45
1x rate_card_items | rate_card_id,code,unit_price_ex_gst,rate_cards!inner(business_id) | in rate_cards.business_id [b1] eq rate_cards.is_active true @ installer-paid-electricians.server.ts:27 < installer-paid-electricians.server.ts:98
1x rate_cards | id,business_id,version,effective_from | in business_id [b1] eq is_active true @ installer-paid-electricians.server.ts:25 < installer-paid-electricians.server.ts:45
1x rate_cards | id,business_id,version,effective_from | in business_id [b1] eq is_active true @ installer-paid-electricians.server.ts:25 < installer-paid-electricians.server.ts:98
1x rectification_items | description, status | eq job_id 02 @ trade-view.server.ts:1213
1x rectification_items | id | eq job_id 02 @ electrical-clearance.server.ts:52 < install-days.server.ts:24
1x rectification_items | id | eq job_id 02 @ electrical-clearance.server.ts:52 < trade-job-bundle.server.ts:117
1x rpc:has_contact_release |  |
1x rpc:sb:can_access_job |  |
1x rpc:sb:getUser |  |
1x rpc:sb:has_role |  |
1x rpc:sb:is_admin |  |
1x rpc:sb:my_job_role |  |
1x user_roles | role | eq user_id u1 @ trade-view.server.ts:68 < trade-view.server.ts:87
1x worker_job_links | id, worker_id, business_id, created_at, expires_at, revoked_at, last_opened_at, open_count, partner_workers(full_legal_name, trade_role) | eq job_id 02 in business_id [b1] @ worker-links.server.ts:42
1x workflow_events | created_at | eq job_id 02 eq event_type "new_quote_requested" @ installer-price.server.ts:39 < installer-price-set.server.ts:112
1x workflow_events | created_at | eq job_id 02 eq event_type "quote_declined" @ trade-view.server.ts:1209
1x workflow_events | created_at | eq job_id 02 eq event_type "ready_check_basics" contains details {"completed":true} @ trade-view.server.ts:1210
1x workflow_events | created_at, details | eq job_id 02 eq event_type "piesa_superseded_on_reopen" contains details {"had_check":true} @ repeat-piesa.server.ts:61 < repeat-piesa.server.ts:73
1x workflow_events | details | eq job_id 02 eq event_type "electrician_choice_set" @ electrician-choice.server.ts:10 < installer-price-set.server.ts:122
1x workflow_events | details | eq job_id 02 eq event_type "mitti_electrician_recorded" @ mitti-job-presentation.server.ts:12
1x workflow_events | details | eq job_id 02 eq event_type "mitti_piisa_audit_created" @ trade-view.server.ts:1146 < trade-view.server.ts:1204
1x workflow_events | details | eq job_id 02 eq event_type "mitti_piisa_audit_created" @ visit-allocation.server.ts:57 < visit-allocation.server.ts:83
1x workflow_events | details | eq job_id 02 eq event_type "piisa_crew_selected" @ piisa-a3.server.ts:58 < swms.server.ts:21
1x workflow_events | details | eq job_id 02 eq event_type "piisa_crew_selected" @ piisa-a3.server.ts:58 < trade-job-bundle.server.ts:154
1x workflow_events | details | eq job_id 02 eq event_type "ready_check_basics" @ installer-quote-status.server.ts:24 < job-shared-reads.ts:31
1x workflow_events | details | eq job_id 02 eq event_type "ready_check_basics" @ mitti-job-presentation.server.ts:13
1x workflow_events | details | eq job_id 02 eq event_type "swms_site_note" @ swms.server.ts:48 < swms.server.ts:84
1x workflow_events | details, created_at | eq job_id 02 eq event_type "install_evidence_synced" @ trade-view.server.ts:1214
1x workflow_events | details, created_at | eq job_id 02 eq event_type "installer_note" @ ai-email-reply.server.ts:173 < trade-view.server.ts:1220
1x workflow_events | details, created_at | eq job_id 02 eq event_type "swms_signed" @ swms.server.ts:78 < swms.server.ts:84
1x workflow_events | details, created_at, actor_id | eq job_id 02 eq event_type "installer_price_set" @ installer-price.server.ts:31 < installer-price-set.server.ts:112
1x workflow_events | event_type, created_at, details | eq job_id 02 in event_type ["repeat_piesa_payer_chosen","repeat_piesa_accepted","repeat_piesa_paid","install_window_expired"] @ repeat-piesa.server.ts:74 < repeat-piesa.server.ts:74
1x workflow_events | event_type, details, created_at | eq job_id 02 eq event_type "visit_allocated" @ trade-view.server.ts:1215
1x workflow_events | event_type, details, created_at | eq job_id 02 eq event_type "visit_allocated" @ visit-allocation.server.ts:50 < visit-allocation.server.ts:79
1x workflow_events | event_type, summary | eq job_id 02 in event_type ["mitti_access_needed","mitti_audit_created","mitti_audit_reshared"] @ worker-links.server.ts:34 < trade-job-bundle.server.ts:122
1x workflow_events | job_id, created_at | eq event_type "stage_changed" eq to_stage "ready_for_veec" in job_id [04,01] @ trade-view.server.ts:556
1x workflow_events | job_id, created_at, details | eq event_type "payout_marked_paid" in job_id [04,01] @ trade-view.server.ts:555
1x workflow_events | job_id, details, created_at | in job_id [04,01] eq event_type "electrician_form_approved" @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:45
1x workflow_events | job_id, details, created_at | in job_id [04,01] eq event_type "electrician_form_approved" @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:96
1x workflow_events | job_id, details, created_at | in job_id [04,01] eq event_type "install_evidence_synced" @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:43
1x workflow_events | job_id, event_type, created_at, summary, details | in job_id [04,01] in event_type ["fixes_form_created","fixes_form_completed","fixes_form_not_done","fixes_form_held"] @ trade-payout-gate.server.ts:18 < trade-payout-gate.server.ts:41
1x workflow_settings | payment_option_gate_enabled | eq id 1 @ workflow.server.ts:137 < workflow.server.ts:145
1x workflow_settings | safety_check_payment_inc_gst | eq id 1 @ payments.server.ts:191 < trade-view.server.ts:1166
```

## installer staff, assigned booked job (J2): 4 waves, 111 reads (sign-in client calls: getUser,my_job_role,is_admin,can_access_job,has_role)

Per table: workflow_events 18, bookings 13, job_assignments 12, jobs 12, piesa_records 6, quotes 5, ceiling_measurements 4, partner_workers 4, appointment_proposals 3, rectification_items 3, admin_config_events 2, assessments 2, business_members 2, customer_assignments 2, installer_declarations 2, job_piesa_deadlines 2, partner_activations 2, profiles 2, workflow_settings 2, businesses 1, invoices 1, job_overview 1, owner_esc_consents 1, properties 1, rpc:has_contact_release 1, rpc:sb:can_access_job 1, rpc:sb:getUser 1, rpc:sb:has_role 1, rpc:sb:is_admin 1, rpc:sb:my_job_role 1, user_roles 1, worker_job_links 1

## installer staff, assigned ready check job (J3): 3 waves, 72 reads (sign-in client calls: getUser,my_job_role,is_admin,can_access_job,has_role)

Per table: workflow_events 14, job_assignments 8, jobs 8, bookings 6, ceiling_measurements 4, business_members 3, quotes 3, appointment_proposals 2, customer_assignments 2, installer_declarations 2, piesa_records 2, profiles 2, rectification_items 2, assessments 1, job_overview 1, job_piesa_deadlines 1, partner_workers 1, properties 1, ready_checks 1, rpc:has_contact_release 1, rpc:sb:can_access_job 1, rpc:sb:getUser 1, rpc:sb:has_role 1, rpc:sb:is_admin 1, rpc:sb:my_job_role 1, user_roles 1, worker_job_links 1

## installer staff, not assigned (J1): 2 waves, 12 reads (sign-in client calls: getUser,my_job_role)

Per table: business_members 2, job_assignments 2, job_overview 1, jobs 1, profiles 1, properties 1, rpc:has_contact_release 1, rpc:sb:getUser 1, rpc:sb:my_job_role 1, user_roles 1

## electrician (J1): 3 waves, 19 reads (sign-in client calls: getUser,my_job_role,is_admin)

Per table: business_members 3, job_assignments 3, profiles 2, job_overview 1, jobs 1, partner_workers 1, properties 1, rpc:has_contact_release 1, rpc:sb:getUser 1, rpc:sb:is_admin 1, rpc:sb:my_job_role 1, user_roles 1, worker_job_links 1, workflow_events 1

## electrician (J2): 3 waves, 18 reads (sign-in client calls: getUser,my_job_role,is_admin)

Per table: job_assignments 3, business_members 2, profiles 2, job_overview 1, jobs 1, partner_workers 1, properties 1, rpc:has_contact_release 1, rpc:sb:getUser 1, rpc:sb:is_admin 1, rpc:sb:my_job_role 1, user_roles 1, worker_job_links 1, workflow_events 1

## user with no access (J1): 2 waves, 12 reads (sign-in client calls: getUser,my_job_role)

Per table: business_members 2, job_assignments 2, job_overview 1, jobs 1, profiles 1, properties 1, rpc:has_contact_release 1, rpc:sb:getUser 1, rpc:sb:my_job_role 1, user_roles 1

