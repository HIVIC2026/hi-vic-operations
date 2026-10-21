// Builds the old "To action" list from live data. Kept so Needs me can show anything only it knew about.
import { buildTodos, type TodoItem } from "./todo.core";
type Admin = typeof import("@/integrations/supabase/client.server").supabaseAdmin;
export async function loadTodos(admin: Admin): Promise<TodoItem[]> {
    const ok = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
      if (r.error) throw new Error(`Could not load ${what}: ${r.error.message}`);
      return (r.data ?? []) as T;
    };
    const [jobs, invoices, invStatus, rect, meas, reas, penq, esc, books, pdel, elecA, accQ, pw] = await Promise.all([
      admin.from("job_overview").select("id, job_number, property_address, stage, source, eligibility_review_required, eligibility_outcome").not("stage", "in", "(complete,cancelled)"),
      admin.from("invoices").select("id, job_id, xero_invoice_id, xero_invoice_number, deposit_request_raised_at, deposit_amount, status, last_sync_error, xero_update_pending, created_at"),
      admin.from("invoice_status").select("id, deposit_cleared, effective_status"),
      admin.from("rectification_items").select("id, job_id, description, created_at").eq("needs_office_pricing", true),
      admin.from("ceiling_measurements").select("id, job_id, created_at").eq("is_current", true).eq("status", "needs_review"),
      admin.from("reassignment_requests").select("id, job_id, role, reason, created_at").is("resolved_at", null),
      admin.from("partner_enquiries").select("id, name, enquiry_type, source, created_at").in("status", ["new", "submitted"]).neq("enquiry_type", "property_manager").or("source.is.null,source.not.in.(portal_rec_onboarding_test,portal_installer_onboarding_test)"),
      admin.from("esc_notifications").select("id, job_id, status, due_by, sent_at, last_error, created_at").is("sent_at", null),
      admin.from("bookings").select("id, job_id, scheduled_start").eq("kind", "installation").in("status", ["proposed", "confirmed"]),
      admin.from("piesa_deliveries").select("job_id, recipient"),
      admin.from("job_assignments").select("job_id").eq("role", "electrician").eq("active", true),
      admin.from("quotes").select("job_id").eq("kind", "installation").eq("status", "accepted"),
      admin.from("partner_workers").select("id, full_legal_name, created_at, businesses(name)").eq("approval_status", "pending").is("removed_at", null),
    ]);
    const jobRows = ok(jobs, "jobs").filter((j) => j.source !== "qa_test");
    const cleared = new Map(ok(invStatus, "payment status").map((s) => [s.id, s]));
    const items = buildTodos({
      now: Date.now(),
      jobs: jobRows.map((j) => ({ id: j.id!, job_number: j.job_number, property: j.property_address, stage: j.stage as string, eligibility_review_required: j.eligibility_review_required, eligibility_outcome: j.eligibility_outcome })),
      invoices: ok(invoices, "invoices").map((v) => ({ ...v, deposit_amount: v.deposit_amount == null ? null : Number(v.deposit_amount), deposit_cleared: cleared.get(v.id)?.deposit_cleared ?? false, status: (cleared.get(v.id)?.effective_status ?? v.status) as string })),
      rectOther: ok(rect, "electrical fixes items"),
      measureReview: ok(meas, "measure-ups"),
      reassignments: ok(reas, "reassignment requests").map((r) => ({ ...r, role: String(r.role) })),
      partnerEnquiries: ok(penq, "partner enquiries").map((p) => ({ id: p.id, name: p.name, kind: p.enquiry_type, source: p.source, created_at: p.created_at })),
      escNotices: ok(esc, "ESC notices"),
      installBookings: ok(books, "install bookings"),
      piesaDeliveries: ok(pdel, "PIESA deliveries"),
      electricianJobs: new Set(ok(elecA, "electrician assignments").map((r) => r.job_id)),
      pendingWorkers: ok(pw, "pending workers").map((w) => ({ id: w.id, full_legal_name: w.full_legal_name, created_at: w.created_at, business: (w.businesses as { name: string } | null)?.name ?? null })),
      acceptedQuoteJobs: new Set(ok(accQ, "accepted quotes").map((r) => r.job_id)),
    });
    // Onsite forms that trades can't open yet because the Mitti form isn't connected.
    const { data: ws, error: wsErr } = await admin.from("workflow_settings").select("mitti_ready_check_template_id, mitti_ready_check_priced_template_id, mitti_piesa_template_id, mitti_piisa_template_id").eq("id", 1).maybeSingle();
    if (wsErr) throw new Error(`Could not load form settings: ${wsErr.message}`);
    const forms: [string, string | null | undefined][] = [["A1 Ready Check (installer's own customer)", ws?.mitti_ready_check_priced_template_id], ["A2 Ready Check (our lead)", ws?.mitti_ready_check_template_id], ["B Pre Insulation Electrical Safety Assessment (PIESA)", ws?.mitti_piesa_template_id], ["C PIISA installer Pre Insulation Electrical Safety Assessment (PIESA)", ws?.mitti_piisa_template_id]];
    for (const [name, id] of forms) if (!id) items.unshift({ key: `mitti-form:${name}`, category: "Compliance", jobId: null, jobNumber: null, property: null, title: `Onsite form not set up: ${name}`, action: "Connect the Mitti form in Compliance → Mitti forms. Trades see “Form being set up” until then.", tab: null, since: null, urgent: true });
    return items;
}
