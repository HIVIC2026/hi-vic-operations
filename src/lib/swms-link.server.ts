// Decision 364 (Jo 25 Oct 2026): each crew member signs the safety plan (SWMS) on their OWN phone. A person without a
// portal login gets a personal secure link: an HMAC-signed token (job + signer key + expiry) to the public /sp/<token>
// page, which shows the plan and signs ONLY that person's line (typed full name, through the same `signSwms` checks).
// Nothing is stored for the link; the secret is derived from the server-held ONBOARDING_FP_SECRET (fails closed).
// The existing `worker_job_links` staff links were not reused: they are made by hand per approved worker (creating one
// revokes the company's current link) and crew typed in by name have no worker record.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SWMS_LINK_DAYS = 7;
const DAY_S = 86_400;
export type SwmsLinkPayload = { jobId: string; key: string; exp: number };

/** Derived per-purpose key; throws when the server secret is missing (no link is ever made without it). */
export function swmsLinkSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env["ONBOARDING_FP_SECRET"];
  if (!s) throw new Error("Safety plan links are not configured.");
  return createHmac("sha256", s).update("hivic-swms-sign-link-v1").digest("hex");
}

const sig = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function swmsLinkToken(p: SwmsLinkPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify({ j: p.jobId, k: p.key, e: p.exp })).toString("base64url");
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
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as { j?: unknown; k?: unknown; e?: unknown };
    if (typeof t.j !== "string" || typeof t.k !== "string" || typeof t.e !== "number" || !t.j || !t.k) return null;
    if (t.e * 1000 <= nowMs) return null;
    return { jobId: t.j, key: t.k, exp: t.e };
  } catch { return null; }
}

/** Expiry SWMS_LINK_DAYS ahead, rounded to the UTC day so the same day's texts carry the same link. */
export const swmsLinkExpiry = (nowMs = Date.now()) => (Math.floor(nowMs / 1000 / DAY_S) + 1 + SWMS_LINK_DAYS) * DAY_S;

export async function swmsSignLink(jobId: string, key: string, nowMs = Date.now()): Promise<string> {
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  return `${SET_PASSWORD_BASE}/sp/${swmsLinkToken({ jobId, key, exp: swmsLinkExpiry(nowMs) }, swmsLinkSecret())}`;
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
  load: (jobId: string) => Promise<{ plan: import("./swms.core").SwmsPlan; signatures: import("./swms.core").SwmsSignature[]; job: { installation_completed_at: string | null; deleted_at: string | null } | null }>;
  sign: (jobId: string, key: string, typedName: string) => Promise<{ complete: boolean; missing: string[] }>;
  /** Decision 411: the PIESA result and the hazards noted at the Ready Check / PIESA, shown with the SWMS. */
  extras?: (jobId: string) => Promise<SafetyExtras>;
};
export type SafetyExtras = { piesa: { outcome: string | null; kind: string | null; completedDate: string | null; notes: string | null } | null; hazardNote: string | null };

export async function loadSafetyExtras(jobId: string): Promise<SafetyExtras> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const [{ data: p }, { data: a }] = await Promise.all([
    admin.from("piesa_records").select("outcome, kind, completed_date, notes").eq("job_id", jobId).eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("assessments").select("hazards").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    piesa: p ? { outcome: p.outcome ?? null, kind: p.kind ?? null, completedDate: p.completed_date ?? null, notes: p.notes ?? null } : null,
    hazardNote: typeof a?.hazards === "string" && a.hazards.trim() ? a.hazards.trim() : null,
  };
}
const defaultDeps: SwmsLinkDeps = {
  secret: () => swmsLinkSecret(),
  load: async (jobId) => {
    const { loadSwms } = await import("./swms.server");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [{ plan, signatures }, { data: job }] = await Promise.all([loadSwms(jobId), admin.from("jobs").select("installation_completed_at, deleted_at").eq("id", jobId).maybeSingle()]);
    return { plan, signatures, job: job ?? null };
  },
  // The token's own key only, recorded as method "link"; signSwms still checks the typed name and once-only.
  sign: async (jobId, key, typedName) => (await import("./swms.server")).signSwms(jobId, null, key, typedName, "link"),
};

/** The public page's read and sign. The token is the only credential and names one signer key on one job. */
async function resolve(token: string, deps: SwmsLinkDeps, nowMs: number) {
  const p = verifySwmsLinkToken(token, deps.secret(), nowMs);
  if (!p) throw new Error("This safety plan link isn't valid or has expired. Ask your business owner to send it again.");
  const { latestSignatures } = await import("./swms.core");
  const { plan, signatures, job } = await deps.load(p.jobId);
  if (!job || job.deleted_at) throw new Error("This job is no longer available.");
  const signer = plan.signers.find((s) => s.key === p.key);
  if (!signer) throw new Error("You're no longer on this job's crew. Ask your business owner.");
  return { p, plan, signer, signed: latestSignatures(signatures).get(p.key) ?? null, open: !job.installation_completed_at };
}

export async function swmsLinkView(token: string, deps: SwmsLinkDeps = defaultDeps, nowMs = Date.now()) {
  const { p, plan, signer, signed, open } = await resolve(token, deps, nowMs);
  const extras = await (deps.extras ?? loadSafetyExtras)(p.jobId).catch(() => ({ piesa: null, hazardNote: null }) as SafetyExtras);
  return {
    piesa: extras.piesa, hazardNote: extras.hazardNote,
    jobNumber: plan.jobNumber, address: plan.address, installDate: plan.installDate, businessName: plan.businessName,
    highRiskWork: plan.highRiskWork, hazards: plan.hazards.map((h) => ({ name: h.name, control: h.control })), siteNote: plan.siteNote,
    signer: { name: signer.name, role: signer.role }, signedAt: signed?.signedAt ?? null, open,
  };
}

export async function swmsLinkSign(token: string, typedName: string, deps: SwmsLinkDeps = defaultDeps, nowMs = Date.now()) {
  const { p, open } = await resolve(token, deps, nowMs);
  if (!open) throw new Error("The installation is recorded; the safety plan can't be changed now.");
  return deps.sign(p.jobId, p.key, typedName);
}
