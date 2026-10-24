// Decision 255 (Jo 24 Oct 2026): a new sender with no job emails an enquiry (or a price / rebate question). Create the
// enquiry from the email through the EXISTING guarded intake (`upsertEnquiry`, source 'email' — qa_test in reply-draft
// TEST mode), then mint its secure homeowner link with the existing helper (`ensureOwnerLink`), so the reply DRAFT can
// carry that page instead of the calculator. Called only by the reply drafter (email-reply.server), behind
// EMAIL_REPLY_DRAFTS_ENABLED and the TEST allow-list. Never sends anything.
// - Dedupe: an owner already on file with this email address is LINKED (their latest live job), never duplicated.
// - Facts: name = the From display name tidied, the email address, a phone only when exactly one is written, and an
//   address only when a COMPLETE Victorian street address is written (pure email-enquiry.core) — never guessed. No
//   address → the job lands in Enquiries › Fix details and the reply asks for it.
// - Consent: the email is consent to reply to that email only. No `owner_contact_consents` row is written here; the
//   homeowner page captures the VEU consent as for every enquiry. The sentence is recorded on the event.
// - Idempotent per Outlook message: one `email_enquiry_created` event (and one external enquiry id) per message.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailMessage } from "./outlook-correspondence.core";
import { exactLike } from "./email-match";
import { logEvent } from "./workflow.server";
import { EMAIL_ENQUIRY_CONSENT_SENTENCE, EMAIL_ENQUIRY_CREATED_EVENT, EMAIL_ENQUIRY_SOURCE, planEmailEnquiry } from "./email-enquiry.core";

const loose = admin as unknown as SupabaseClient;

export type EmailEnquiryOutcome =
  | { status: "created" | "reused"; jobId: string; jobNumber: string; addressFound: boolean; linkReady: boolean }
  | { status: "existing_owner"; jobId: string }
  | { status: "skipped"; reason: string };

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Gate 1 first (the homeowner page only opens once an official decision allows it), then the existing link helper. */
async function prepareHomeownerLink(jobId: string, source: string): Promise<boolean> {
  try {
    if (source === "qa_test") {
      // TEST jobs never enter the live post-intake queue; decide Gate 1 directly, exactly as the TEST journey does.
      await (await import("./eligibility.server")).autoDecideEligibility(jobId);
    } else {
      await (await import("./postintake.server")).processPostIntakeWork({ jobId });
    }
  } catch (e) { console.error("email enquiry: initial checks deferred to the worker", e instanceof Error ? e.message : e); }
  try { return await (await import("./estimatelink.server")).ensureOwnerLink(jobId); }
  catch { return false; }
}

export async function enquiryFromEmail(m: MailMessage, opts: { testOnly: boolean }): Promise<EmailEnquiryOutcome> {
  const plan = planEmailEnquiry(m);
  if (!plan) return { status: "skipped", reason: "The email has no sender address to create an enquiry for" };

  // Same message seen again (e.g. the draft failed last time): reuse the enquiry it created.
  const { data: prior, error: pe } = await loose.from("workflow_events").select("job_id, details").eq("event_type", EMAIL_ENQUIRY_CREATED_EVENT).contains("details", { message_id: m.providerMessageId }).limit(1);
  if (pe) throw new Error(pe.message);
  const before = (prior ?? [])[0] as { job_id: string | null; details: { address_found?: boolean } | null } | undefined;
  if (before?.job_id) {
    const { data: j } = await admin.from("jobs").select("id, job_number, deleted_at").eq("id", before.job_id).maybeSingle();
    if (!j || j.deleted_at) return { status: "skipped", reason: "The enquiry created from this email was removed" };
    const linkReady = !!(await (await import("./estimatelink.server")).adminLinkPath(j.id).catch(() => null));
    return { status: "reused", jobId: j.id, jobNumber: j.job_number, addressFound: before.details?.address_found === true, linkReady };
  }

  // Dedupe against existing owners by email first: link, never a second owner.
  const { data: owners, error: oe } = await admin.from("owners").select("id").ilike("email", exactLike(plan.email)).limit(5);
  if (oe) throw new Error(oe.message);
  const ownerIds = (owners ?? []).map((o) => o.id);
  if (ownerIds.length) {
    const { data: jobs, error: je } = await admin.from("jobs").select("id").in("owner_id", ownerIds).is("deleted_at", null).order("created_at", { ascending: false }).limit(1);
    if (je) throw new Error(je.message);
    const latest = (jobs ?? [])[0];
    return latest ? { status: "existing_owner", jobId: latest.id } : { status: "skipped", reason: "This email address is already an owner on file without a live job — the office checks it" };
  }

  const source = opts.testOnly ? "qa_test" : EMAIL_ENQUIRY_SOURCE;
  const a = plan.address;
  const { upsertEnquiry } = await import("./enquiry.server");
  const created = await upsertEnquiry({
    external_enquiry_id: `outlook-${(await sha256Hex(m.providerMessageId)).slice(0, 40)}`,
    full_name: plan.fullName, email: plan.email, phone: plan.phone,
    address_line: a?.street ?? "", suburb: a?.suburb ?? null, postcode: a?.postcode ?? null, ...(a ? { state: "VIC" } : {}),
    estimated_area_m2: null, area_unknown: true,
  } as never, source, null, { channel: "hivic_sourced" }, { emailIntake: true });

  await logEvent(created.job_id, null, EMAIL_ENQUIRY_CREATED_EVENT,
    `Enquiry created from ${plan.fullName || "the sender"}'s email (${plan.email})${a ? "" : " — no street address in the email, so it is in Enquiries › Fix details"}. ${EMAIL_ENQUIRY_CONSENT_SENTENCE}`,
    {
      message_id: m.providerMessageId, internet_message_id: m.internetMessageId, thread_id: m.threadId, from: plan.email, from_name: m.fromName,
      subject: m.subject, received_at: m.at, source, address_found: !!a, address: a, phone_found: !!plan.phone, name_from: plan.fullName ? "from_display_name" : null,
      consent_scope: "reply_to_this_email_only", consent_basis: EMAIL_ENQUIRY_CONSENT_SENTENCE, created: created.created,
    }, { internal: true });

  const linkReady = await prepareHomeownerLink(created.job_id, source);
  return { status: "created", jobId: created.job_id, jobNumber: created.job_number, addressFound: !!a, linkReady };
}
