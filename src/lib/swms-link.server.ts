// Decision 364 (Jo 25 Oct 2026): each crew member signs the safety plan (SWMS) on their OWN phone. A person without a
// portal login gets a personal secure link: an HMAC-signed token (job + signer key + expiry) to the public /sp/<token>
// page, which shows the plan and signs ONLY that person's line (typed full name, through the same `signSwms` checks).
// Nothing is stored for the link; the secret is derived from the server-held ONBOARDING_FP_SECRET (fails closed).
// The existing `worker_job_links` staff links were not reused: they are made by hand per approved worker (creating one
// revokes the company's current link) and crew typed in by name have no worker record.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SWMS_LINK_DAYS = 7;
const DAY_S = 86_400;
/** `via: "lead"` (Jo 30 Oct 2026) = issued to the Lead to open on the Lead's phone; part of the signed token. */
export type SwmsLinkPayload = { jobId: string; key: string; exp: number; via?: "lead" };

/** Derived per-purpose key; throws when the server secret is missing (no link is ever made without it). */
export function swmsLinkSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env["ONBOARDING_FP_SECRET"];
  if (!s) throw new Error("Safety plan links are not configured.");
  return createHmac("sha256", s).update("hivic-swms-sign-link-v1").digest("hex");
}

const sig = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function swmsLinkToken(p: SwmsLinkPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(p.via ? { j: p.jobId, k: p.key, e: p.exp, v: p.via } : { j: p.jobId, k: p.key, e: p.exp })).toString("base64url");
  return `${body}.${sig(body, secret)}`;
}

/** Null when the token is malformed, tampered with or expired. */
export function verifySwmsLinkToken(token: string, secret: string, nowMs = Date.now()): SwmsLinkPayload | null {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [body, s, extra] = token.split(".");
  if (!body || !s || extra !== undefined) return null;
  const want = Buffer.from(sig(body, secret)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as { j?: unknown; k?: unknown; e?: unknown; v?: unknown };
    if (typeof t.j !== "string" || typeof t.k !== "string" || typeof t.e !== "number" || !t.j || !t.k) return null;
    if (t.e * 1000 <= nowMs) return null;
    return t.v === "lead" ? { jobId: t.j, key: t.k, exp: t.e, via: "lead" } : { jobId: t.j, key: t.k, exp: t.e };
  } catch { return null; }
}

/** Expiry SWMS_LINK_DAYS ahead, rounded to the UTC day so the same day's texts carry the same link. */
export const swmsLinkExpiry = (nowMs = Date.now()) => (Math.floor(nowMs / 1000 / DAY_S) + 1 + SWMS_LINK_DAYS) * DAY_S;

export async function swmsSignLink(jobId: string, key: string, nowMs = Date.now(), via?: "lead"): Promise<string> {
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  return `${SET_PASSWORD_BASE}/sp/${swmsLinkToken({ jobId, key, exp: swmsLinkExpiry(nowMs), ...(via ? { via } : {}) }, swmsLinkSecret())}`;
}

/** Each unsigned person's own link (lead first). Null = the plan can't be read, nobody is chosen yet, or links aren't
 *  configured — the caller keeps the decision 266 job-page link instead. Empty = everyone has signed.
 *  Decision 377: `ownLinkTexted` = that person's own link already went to their own mobile (swms-sign-text.server), so
 *  the lead's text lists them by name only. */
export async function unsignedSwmsSignerLinks(jobId: string): Promise<{ name: string; link: string; ownLinkTexted: boolean }[] | null> {
  try {
    const { loadSwms } = await import("./swms.server");
    const { swmsUnsignedSigners } = await import("./swms.core");
    const { plan, signatures, status } = await loadSwms(jobId);
    if (status.complete) return [];
    const todo = swmsUnsignedSigners(plan, signatures);
    if (!todo.length) return null;
    const texted = await (await import("./swms-sign-text.server")).swmsOwnLinkTextedKeys(jobId);
    return await Promise.all(todo.map(async (s) => ({ name: s.name, link: await swmsSignLink(jobId, s.key), ownLinkTexted: texted.has(s.key) })));
  } catch { return null; }
}

/** What the public page needs from the server; injectable for tests (defaults read the job and sign through swms.server). */
export type SwmsLinkDeps = {
  secret: () => string;
  /** Part 7 Task 3: `installStart` = the current install booking's start (ISO), for the page's "for tomorrow" title and when-line. */
  load: (jobId: string) => Promise<{ plan: import("./swms.core").SwmsPlan; signatures: import("./swms.core").SwmsSignature[]; job: { installation_completed_at: string | null; deleted_at: string | null } | null; installStart?: string | null;
    /** Part 7 Task 4: the job's A5 install form audit id (the real audit from the booking's form source), null until it exists. */
    installFormAuditId?: string | null }>;
  sign: (jobId: string, key: string, typedName: string, method: import("./swms.core").SwmsSignMethod) => Promise<{ complete: boolean; missing: string[] }>;
  /** Part 7 Task 3: the full plan as a PDF, built on demand (default = buildSwmsPdf in its flag-driven look). */
  pdf?: (plan: import("./swms.core").SwmsPlan, signatures: import("./swms.core").SwmsSignature[]) => Promise<Uint8Array>;
  /** Part 7 Task 4: a person's own sign link (default = swmsSignLink); `via: "lead"` = opened on the Lead's phone. */
  signLink?: (jobId: string, key: string, via: "lead" | undefined, nowMs: number) => Promise<string>;
};
const defaultDeps: SwmsLinkDeps = {
  secret: () => swmsLinkSecret(),
  load: async (jobId) => {
    const { loadSwms } = await import("./swms.server");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { bookingFormAuditId } = await import("./daily-mitti-text.server");
    const { currentInstallBooking } = await import("./install-booking.server");
    // One round trip: plan + signatures, the job, the current install booking and the install form's audit id together.
    const [{ plan, signatures }, { data: job }, book, installFormAuditId] = await Promise.all([
      loadSwms(jobId),
      admin.from("jobs").select("installation_completed_at, deleted_at").eq("id", jobId).maybeSingle(),
      currentInstallBooking(jobId).catch(() => null),
      bookingFormAuditId(jobId, "installation").catch(() => null),
    ]);
    return { plan, signatures, job: job ?? null, installStart: book?.scheduled_start ?? null, installFormAuditId };
  },
  // The token's own key only, recorded as "link" (or "lead_phone" for a Lead's-phone link); signSwms still checks the
  // typed name and once-only.
  sign: async (jobId, key, typedName, method) => (await import("./swms.server")).signSwms(jobId, null, key, typedName, method),
  // Not filed, not stored: a read of the current plan in whichever look PDF_LOOK_APPROVED.swms selects.
  pdf: async (plan, signatures) => (await (await import("./swms-pdf.server")).buildSwmsPdf(plan, signatures, { recordRef: null })).bytes,
  signLink: (jobId, key, via, nowMs) => swmsSignLink(jobId, key, nowMs, via),
};

/** The public page's read and sign. The token is the only credential and names one signer key on one job. */
async function resolve(token: string, deps: SwmsLinkDeps, nowMs: number) {
  const p = verifySwmsLinkToken(token, deps.secret(), nowMs);
  if (!p) throw new Error("This safety plan link isn't valid or has expired. Ask your business owner to send it again.");
  const { latestSignatures } = await import("./swms.core");
  const { plan, signatures, job, installStart, installFormAuditId } = await deps.load(p.jobId);
  if (!job || job.deleted_at) throw new Error("This job is no longer available.");
  const signer = plan.signers.find((s) => s.key === p.key);
  if (!signer) throw new Error("You're no longer on this job's crew. Ask your business owner.");
  return { p, plan, signatures, signer, signed: latestSignatures(signatures).get(p.key) ?? null, open: !job.installation_completed_at, installStart: installStart ?? null, installFormAuditId: installFormAuditId ?? null };
}

/** Part 7 Task 3: the page's one read. The words are the plan's own rule's (`swmsWordingFor`), so a person signing a plan
 *  prepared on the 24 Oct wording reads exactly what they sign. */
export async function swmsLinkView(token: string, deps: SwmsLinkDeps = defaultDeps, nowMs = Date.now()): Promise<import("./swms-sign-page.core").SwmsSignPageView> {
  const { p, plan, signatures, signer, signed, open, installStart, installFormAuditId } = await resolve(token, deps, nowMs);
  const { latestSignatures, swmsHouseSection, swmsWordingFor } = await import("./swms.core");
  // Part 7 Task 4: only the Lead Installer's OWN token carries the lead block (a crew member's link opened on the Lead's
  // phone names the crew member's key, so it never does). Signed = a current-plan signature on that line.
  let lead: import("./swms-sign-page.core").SwmsSignPageView["lead"] = null;
  if (signer.role === "lead" && !p.via) {
    const by = latestSignatures(signatures);
    const { mittiFormUrl } = await import("./mitti-link.core");
    const signers = plan.signers.map((s) => ({ key: s.key, name: s.name, role: s.role, signed: by.has(s.key) }));
    lead = { signers, signedCount: signers.filter((s) => s.signed).length, total: signers.length, installFormUrl: installFormAuditId ? mittiFormUrl(installFormAuditId) : null };
  }
  return {
    jobNumber: plan.jobNumber, address: plan.address, installDate: plan.installDate, installStart, businessName: plan.businessName,
    rule: plan.rule, highRiskWork: plan.highRiskWork, hazards: plan.hazards.map((h) => ({ name: h.name, control: h.control })), howInPlace: swmsWordingFor(plan.rule).howInPlace,
    siteNote: plan.siteNote, house: swmsHouseSection(plan),
    signer: { name: signer.name, role: signer.role }, signedAt: signed?.signedAt ?? null, open, lead,
  };
}

/** Part 7 Task 4 (Jo 30 Oct / 2 Nov 2026): the Lead opens a crew member's OWN sign link on the Lead's phone. Only the
 *  Lead's own token may ask; the crew member must be on the plan and unsigned (`swmsLeadPhoneBlocker`); the link is that
 *  person's key with `via: "lead"`, so the signature records "lead_phone" and still needs THEIR typed full name. */
export async function swmsLinkLeadPhone(token: string, crewKey: string, deps: SwmsLinkDeps = defaultDeps, nowMs = Date.now()): Promise<{ url: string }> {
  const { p, plan, signatures, open } = await resolve(token, deps, nowMs);
  if (!open) throw new Error("The installation is recorded; the safety plan can't be changed now.");
  const { swmsLeadPhoneBlocker } = await import("./swms.core");
  const block = swmsLeadPhoneBlocker(plan, signatures, crewKey, p.via ? [] : [p.key]);
  if (block) throw new Error(block);
  const make = deps.signLink ?? defaultDeps.signLink!;
  return { url: await make(p.jobId, crewKey, "lead", nowMs) };
}

/** Part 7 Task 3: the full safety plan as a PDF, only when the person taps for it — same token checks as the view,
 *  built on demand from the current plan and signatures, never filed. */
export async function swmsLinkPdf(token: string, deps: SwmsLinkDeps = defaultDeps, nowMs = Date.now()): Promise<{ filename: string; base64: string }> {
  const { plan, signatures } = await resolve(token, deps, nowMs);
  const build = deps.pdf ?? defaultDeps.pdf!;
  const bytes = await build(plan, signatures);
  return { filename: `swms-${plan.jobNumber}.pdf`, base64: Buffer.from(bytes).toString("base64") };
}

export async function swmsLinkSign(token: string, typedName: string, deps: SwmsLinkDeps = defaultDeps, nowMs = Date.now()) {
  const { p, open } = await resolve(token, deps, nowMs);
  if (!open) throw new Error("The installation is recorded; the safety plan can't be changed now.");
  return deps.sign(p.jobId, p.key, typedName, p.via === "lead" ? "lead_phone" : "link");
}
