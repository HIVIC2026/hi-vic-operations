// Office decisions on signed partner applications. Signed applications stay untouched (DB trigger);
// a send-back copies the answers into a fresh draft the installer edits and signs again.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { APPLICATION_REVIEW_WORDING_APPROVED, changesEmail, declineEmail, reviewInputError, type ReviewDecision } from "./application-review.core";

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const BASE = "https://estimate.homeinsulationvictoria.com.au";

type App = { id: string; status: string; partner_type: string | null; test_mode: boolean | null; data: unknown; partner_enquiry_id: string | null; resume_token_hash: string };

/** Records the decision, reopens a draft for changes, and emails the installer through the existing send rules. */
export async function decideApplication(actorId: string, applicationId: string, decision: ReviewDecision, message: string | null) {
  const err = reviewInputError(decision, message);
  if (err) throw new WorkflowError(err);
  const { data: app } = await admin.from("rec_onboarding_applications").select("id,status,partner_type,test_mode,data,partner_enquiry_id,resume_token_hash,insurance_certificate_path,insurance_file_type,insurance_file_bytes,insurance_file_sha256,insurance_verified_at,insurance_scan_result,authorisation_id,allow_incomplete_sign,contact_hash").eq("id", applicationId).maybeSingle();
  const a = app as (App & { [k in "insurance_certificate_path" | "insurance_file_type" | "insurance_file_bytes" | "insurance_file_sha256" | "insurance_verified_at" | "insurance_scan_result" | "authorisation_id" | "allow_incomplete_sign" | "contact_hash"]: unknown }) | null;
  if (!a || a.status !== "submitted") throw new WorkflowError("Only a signed application can be sent back or declined.");
  if (a.partner_type !== "installer") throw new WorkflowError("Send back and decline are set up for installer applications only.");
  const { data: activated } = await admin.from("partner_activations").select("id").eq("application_id", a.id).maybeSingle();
  if (activated) throw new WorkflowError("This application is already approved.");
  const { data: prior } = await admin.from("application_reviews" as never).select("id").eq("application_id", a.id).maybeSingle();
  if (prior) throw new WorkflowError("A decision has already been recorded for this application.");
  const text = (message ?? "").trim() || null;

  let reopenedId: string | null = null, link: string | null = null;
  if (decision === "changes_requested") {
    const token = newToken();
    const { data: draft, error } = await admin.from("rec_onboarding_applications").insert({
      resume_token_hash: await sha256(token), partner_type: "installer", status: "draft", step_key: "business", test_mode: !!a.test_mode,
      data: a.data as never, insurance_certificate_path: a.insurance_certificate_path, insurance_file_type: a.insurance_file_type, insurance_file_bytes: a.insurance_file_bytes,
      insurance_file_sha256: a.insurance_file_sha256, insurance_verified_at: a.insurance_verified_at, insurance_scan_result: a.insurance_scan_result,
      authorisation_id: a.authorisation_id, allow_incomplete_sign: a.allow_incomplete_sign, contact_hash: a.contact_hash,
    } as never).select("id").single();
    if (error || !draft) throw new WorkflowError("Could not reopen the application. Nothing was changed.");
    reopenedId = (draft as { id: string }).id;
    link = `${BASE}/installer-onboarding?resume=${token}`;
  }
  const { data: review, error: rErr } = await admin.from("application_reviews" as never).insert({ application_id: a.id, decision, message: text, reopened_application_id: reopenedId, created_by: actorId } as never).select("id").single();
  if (rErr || !review) {
    if (reopenedId) await admin.from("rec_onboarding_applications").delete().eq("id", reopenedId).eq("status", "draft");
    throw new WorkflowError("Could not record the decision. Nothing was changed.");
  }
  const reviewId = (review as { id: string }).id;
  if (a.partner_enquiry_id) await admin.from("partner_enquiries").update({ status: decision === "declined" ? "declined" : "closed" } as never).eq("id", a.partner_enquiry_id);

  // Email: TEST applications reach only Jo's allowlisted inbox; real ones wait for Jo to approve the draft wording.
  const d = (a.data ?? {}) as { primary_contact_name?: string; business_email?: string };
  // TEST applications go to Jo's allowlisted test inbox (never the address typed on a test form).
  const to = a.test_mode ? (await import("./test-send.core")).TEST_ALLOWLIST.email[0] : (d.business_email ?? "").trim();
  const mail = decision === "changes_requested" ? changesEmail({ contactName: d.primary_contact_name ?? null, message: text ?? "", link: link!, test: !!a.test_mode }) : declineEmail({ contactName: d.primary_contact_name ?? null, reason: text, test: !!a.test_mode });
  let email: { status: string; detail: string };
  if (!a.test_mode) email = { status: "blocked", detail: APPLICATION_REVIEW_WORDING_APPROVED ? "Real sending is switched off." : "Not sent: the email wording is waiting for Jo's approval." };
  else if (!to) email = { status: "blocked", detail: "No business email on the application." };
  else {
    const { sendTestEmail } = await import("./test-send.server");
    const r = await sendTestEmail({ jobId: null, jobSource: null, partnerIsTest: true, label: `application_${decision}`, actorId }, to, mail.subject, mail.html, mail.text);
    email = { status: r.status, detail: r.detail };
  }
  await admin.from("application_reviews" as never).update({ email_status: email.status, email_detail: email.detail } as never).eq("id", reviewId);
  return { reviewId, reopenedId, email, testLink: a.test_mode ? link : null };
}

/** The installer's link: follows send-backs to the newest draft and reports the office state. */
export async function resolveReviewedApp<T extends { id: string; status: string }>(app: T, load: (id: string) => Promise<T | null>) {
  let cur = app, message: string | null = null;
  for (let i = 0; i < 10; i++) {
    const { data: inbound } = await admin.from("application_reviews" as never).select("message").eq("reopened_application_id", cur.id).maybeSingle();
    if (inbound) message = (inbound as { message: string | null }).message;
    if (cur.status !== "submitted") break;
    const { data: r } = await admin.from("application_reviews" as never).select("decision,message,reopened_application_id").eq("application_id", cur.id).maybeSingle();
    const rv = r as { decision: ReviewDecision; message: string | null; reopened_application_id: string | null } | null;
    if (!rv) return { app: cur, officeMessage: null, review: "with_office" as const };
    if (rv.decision === "declined") return { app: cur, officeMessage: null, review: "declined" as const };
    const next = rv.reopened_application_id ? await load(rv.reopened_application_id) : null;
    if (!next) return { app: cur, officeMessage: rv.message, review: "changes_requested" as const };
    cur = next;
  }
  return { app: cur, officeMessage: cur.status === "draft" ? message : null, review: cur.status === "draft" ? ("changes_requested" as const) : ("with_office" as const) };
}
