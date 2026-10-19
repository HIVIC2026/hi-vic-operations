// No-login owner verification: secure link + 6-digit code -> short signing session. Server-only.
import { CODE_MAX_ATTEMPTS } from "./owner-verify.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isWellFormedToken, LINK_PURPOSE, linkUsable } from "./estimatelink.core";
import { hashToken, newToken } from "./worker-links.core";
import { CODES_PER_HOUR, CODE_TTL_MIN, SESSION_TTL_MIN, codeBlocker, maskContact, newCode, requestBlocker, sessionUsable } from "./owner-verify.core";
import { logEvent, WorkflowError } from "./workflow.server";

async function jobForLink(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token as string).eq("purpose", LINK_PURPOSE).maybeSingle();
  return l && linkUsable(l) ? l.job_id : null;
}

async function ownerOf(jobId: string) {
  const { data } = await admin.from("jobs").select("source, owner_id, owners(id, full_name, email, phone, user_id)").eq("id", jobId).single();
  return { source: data?.source ?? null, owner: data?.owners as { id: string; full_name: string; email: string | null; phone: string | null; user_id: string | null } | null };
}

const codeHash = (jobId: string, code: string) => hashToken(`owner-code:${jobId}:${code}`);

/** Where codes can go (masked) — shown before the owner taps "Send me a code". */
export async function ownerCodeOptions(token: unknown) {
  const jobId = await jobForLink(token);
  if (!jobId) return null;
  const { owner, source } = await ownerOf(jobId);
  return { sms: maskContact("sms", owner?.phone), email: maskContact("email", owner?.email), test: source === "qa_test" };
}

export async function requestOwnerCode(token: unknown, channel: "sms" | "email") {
  const jobId = await jobForLink(token);
  if (!jobId) throw new WorkflowError("This link isn't working. It may have expired.");
  const { owner, source } = await ownerOf(jobId);
  const masked = maskContact(channel, channel === "sms" ? owner?.phone : owner?.email);
  if (!masked) throw new WorkflowError(channel === "sms" ? "We don't have a mobile number for you. Try email instead." : "We don't have an email for you. Try text instead.");
  // Review H: limit check + insert are one locked database step (issue_owner_link_code), so parallel requests can't exceed it.
  const code = newCode();
  const { data: newId, error } = await admin.rpc("issue_owner_link_code", { _job: jobId, _channel: channel, _masked: masked, _hash: await codeHash(jobId, code), _expires: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(), _max: CODES_PER_HOUR });
  if (!error && !newId) throw new WorkflowError(requestBlocker(CODES_PER_HOUR)!);
  const row = newId ? { id: newId as string } : null;
  if (error || !row) throw new Error(error?.message ?? "Could not create a code");
  await logEvent(jobId, null, "owner_code_requested", `Owner asked for a signing code by ${channel === "sms" ? "text" : "email"} (${masked}); delivery follows the sending switches`, { code_id: row.id, channel }, { internal: true });
  if (source !== "qa_test") {
    await (await import("./owner-code-delivery.server")).deliverOwnerCode({ jobId, codeId: row.id, channel, code, owner: { email: owner?.email ?? null, phone: owner?.phone ?? null } });
  }
  // TEST jobs never send anything, so the code is shown on screen for preview checks only.
  return { masked, testCode: source === "qa_test" ? code : null };
}

export async function verifyOwnerCode(token: unknown, code: string) {
  const jobId = await jobForLink(token);
  if (!jobId) throw new WorkflowError("This link isn't working. It may have expired.");
  const { data: r } = await admin.from("owner_link_codes").select("id, channel, attempts, expires_at, verified_at, code_hash").eq("job_id", jobId).is("verified_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const b = codeBlocker(r);
  if (b) throw new WorkflowError(b);
  // Atomic check-and-increment (security review 6 Oct): compare-and-swap on the attempt count, so two parallel
  // guesses can never both use the same try, and nothing is counted once the limit, expiry or use is reached.
  const { data: took } = await admin.from("owner_link_codes").update({ attempts: r!.attempts + 1 }).eq("id", r!.id).eq("attempts", r!.attempts).lt("attempts", CODE_MAX_ATTEMPTS).is("verified_at", null).gt("expires_at", new Date().toISOString()).select("id");
  if (!took?.length) throw new WorkflowError("Please try again in a moment, or ask for a new code.");
  if ((await codeHash(jobId, code)) !== r!.code_hash) throw new WorkflowError("That code doesn't match. Check it and try again.");
  const userId = await ensureOwnerUser(jobId, r!.channel as "sms" | "email");
  const session = newToken();
  await admin.from("owner_link_codes").update({ verified_at: new Date().toISOString(), session_hash: await hashToken(session), session_expires_at: new Date(Date.now() + SESSION_TTL_MIN * 60_000).toISOString(), owner_user_id: userId }).eq("id", r!.id).is("verified_at", null);
  await logEvent(jobId, userId, "owner_code_verified", `Owner verified by ${r!.channel === "sms" ? "text" : "email"} code on the secure link`, { code_id: r!.id }, { internal: true });
  return { session };
}

/** The verified owner for this link + session, or an error. Every signed action re-checks this. */
export async function ownerSession(token: unknown, session: unknown): Promise<{ jobId: string; userId: string; codeId: string; channel: "sms" | "email"; destination: string }> {
  const jobId = await jobForLink(token);
  if (!jobId || typeof session !== "string" || session.length < 40) throw new WorkflowError("Please verify with a code first.");
  const { data: r } = await admin.from("owner_link_codes").select("id, channel, destination_masked, job_id, session_expires_at, owner_user_id").eq("session_hash", await hashToken(session)).maybeSingle();
  if (!r || r.job_id !== jobId || !sessionUsable(r) || !r.owner_user_id) throw new WorkflowError("Your check has timed out. Please get a new code.");
  return { jobId, userId: r.owner_user_id, codeId: r.id, channel: r.channel as "sms" | "email", destination: r.destination_masked };
}

/** The owner's verified identity as a portal user (reuses an existing one; links by verified email or mobile). */
async function ensureOwnerUser(jobId: string, channel: "sms" | "email"): Promise<string> {
  const { owner, source } = await ownerOf(jobId);
  if (!owner) throw new WorkflowError("No owner recorded on this job.");
  if (owner.user_id) return owner.user_id;
  const meta = { full_name: owner.full_name, owner_link: true, ...(source === "qa_test" ? { qa_test: true } : {}) };
  if (channel === "email" && owner.email) {
    const { data: existing } = await admin.from("profiles").select("id").ilike("email", (await import("./email-match")).exactLike(owner.email)).maybeSingle(); // exact match: "_"/"%" are not wildcards
    if (existing?.id) {
      await admin.from("owners").update({ user_id: existing.id }).eq("id", owner.id).is("user_id", null);
      await admin.from("user_roles").upsert({ user_id: existing.id, role: "owner" }, { onConflict: "user_id,role", ignoreDuplicates: true });
      const { data: o } = await admin.from("owners").select("user_id").eq("id", owner.id).single();
      return o?.user_id ?? existing.id;
    }
  }
  const res = channel === "email" && owner.email
    ? await admin.auth.admin.createUser({ email: owner.email, email_confirm: true, user_metadata: meta })
    : await admin.auth.admin.createUser({ phone: toE164(owner.phone!), phone_confirm: true, user_metadata: meta });
  if (res.error || !res.data.user) throw new Error(`Could not record the owner's verified identity: ${res.error?.message ?? "unknown"}`);
  const uid = res.data.user.id;
  await admin.from("owners").update({ user_id: uid }).eq("id", owner.id).is("user_id", null);
  await admin.from("user_roles").upsert({ user_id: uid, role: "owner" }, { onConflict: "user_id,role", ignoreDuplicates: true });
  const { data: o } = await admin.from("owners").select("user_id").eq("id", owner.id).single();
  return o?.user_id ?? uid;
}

/** Australian numbers to +61 form (auth requires E.164). */
export function toE164(v: string): string {
  const d = v.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("61")) return `+${d}`;
  if (d.startsWith("0")) return `+61${d.slice(1)}`;
  return `+61${d}`;
}
