// Decision 303 (Jo 25 Oct 2026: "we can't use the electrician until they're onboarded"). On installer jobs (A1) the
// electrician can only be (a) Home Insulation Victoria's electrician or (b) an APPROVED REC — an approved, active business
// with an approved electrician (trade role electrician) and an ACTIVE onboarded PIESA rate (electrician_rates). The
// installer's usual electrician from My business counts only when that nomination resolves to such a REC (licence/REC
// number first, then exact business name — `matchUsualElectrician`, decision 157). Anyone else — including the retired
// free-text "a different electrician" still carried by old forms / old price-card records — HOLDS the quote with the
// reason "Electrician not onboarded: <name>" and ONE REC onboarding invite is issued to that electrician (by the tick
// sweep in rec-onboarding-invite.server.ts, never from the quote pipeline, which sits on the autoAdvance graph).
// Decision 302: the owner's PIESA line for an approved REC = that REC's onboarded rate; for HIV's electrician = the
// standard setting. PURE: no I/O, no clock.
import { matchUsualElectrician, normaliseLicence, type UsualMatchCandidate } from "./our-lead-piesa-electrician.core";
import type { MittiElectricianResolution, UsualElectrician } from "./usual-electrician.core";

export const ELECTRICIAN_ONBOARDING_NEEDED_EVENT = "electrician_onboarding_needed";
export const REC_ONBOARDING_INVITE_EVENT = "rec_onboarding_invite";
export const REC_ONBOARDING_INVITE_LABEL = "electrician_invite";

/** The hold reason exactly as it appears on the quote, the Needs me row and the office job page. */
export const notOnboardedReason = (name: string) => `Electrician not onboarded: ${name}`;
export const isNotOnboardedReason = (reason: string | null | undefined) => /^Electrician not onboarded: /.test(reason ?? "");
/** Installer job page line while the quote is held for this reason (decision 303). */
export const INSTALLER_NOT_ONBOARDED_LINE = "Your electrician needs to finish onboarding before the quote goes out";
/** Office Needs me row for the same hold. */
export const needsMeNotOnboardedLine = (name: string) => `Quote held · ${notOnboardedReason(name)} · onboarding invite sent to the electrician once`;

export type ApprovedRecCandidate = UsualMatchCandidate & {
  onboarding_status: string | null;
  is_active: boolean | null;
  /** Approved, not-removed electrician workers (partner_workers.trade_role = electrician, approval_status = approved). */
  approved_electricians: number;
  /** The business's ACTIVE PIESA rate row (selectAgreedRate on electrician_rates), null when none. */
  piesa_rate: { id: string; rate_inc_gst: number | string } | null;
};

export type OnboardedRec = { businessId: string; businessName: string | null; rateId: string | null; piesaRateIncGst: number };

/** Why a matched business is NOT an approved REC we may quote (null = fine). Fails closed on every missing fact.
 *  `rateNotNeeded`: the installer pays its own electricians (installer-paid-electricians.core), so no rate is held. */
export function approvedRecBlocker(c: ApprovedRecCandidate, opts: { rateNotNeeded?: boolean } = {}): string | null {
  if (c.onboarding_status !== "approved" || c.is_active === false) return "not an approved, active REC on the portal";
  if (c.approved_electricians < 1) return "no approved electrician on the portal";
  if (!opts.rateNotNeeded && (!c.piesa_rate || !(Number(c.piesa_rate.rate_inc_gst) > 0))) return "no active onboarded PIESA rate";
  if (c.blocker) return c.blocker;
  return null;
}

/** The approved REC that IS the declared electrician, or why there is none. Never borrows another REC's rate.
 *  `flatPiesaIncGst`: the installer pays its own electricians, so the owner line is that flat price, not a REC rate. */
export function approvedRecFor(declared: { name: string | null; licence: string | null }, candidates: ApprovedRecCandidate[], flatPiesaIncGst: number | null = null): { rec: OnboardedRec | null; reason: string | null } {
  const name = (declared.name ?? "").trim();
  if (!name && !normaliseLicence(declared.licence)) return { rec: null, reason: "no electrician named" };
  const m = matchUsualElectrician({ name, licence: declared.licence ?? "", priceIncGst: 0 }, candidates) as ApprovedRecCandidate | null;
  if (!m) return { rec: null, reason: "not on the portal" };
  const blocker = approvedRecBlocker(m, { rateNotNeeded: flatPiesaIncGst != null });
  if (blocker) return { rec: null, reason: blocker };
  if (flatPiesaIncGst != null) return { rec: { businessId: m.business_id, businessName: m.trading_name ?? m.name ?? null, rateId: null, piesaRateIncGst: flatPiesaIncGst }, reason: null };
  return { rec: { businessId: m.business_id, businessName: m.trading_name ?? m.name ?? null, rateId: m.piesa_rate!.id, piesaRateIncGst: Math.round(Number(m.piesa_rate!.rate_inc_gst) * 100) / 100 }, reason: null };
}

/**
 * Decision 303 wrapper around the legacy declared-price resolution: HIV's electrician passes through (standard line);
 * a usual/different electrician is READY only as an approved REC (price = onboarded rate), otherwise HELD
 * "Electrician not onboarded: <name>" with the declared identity kept for the invite. A usual electrician that is not
 * saved at all keeps the legacy `needsProfile` hold (My business reminder path).
 */
export function onboardedElectricianResolution(i: { legacy: MittiElectricianResolution; usual: UsualElectrician | null; candidates: ApprovedRecCandidate[]; flatPiesaIncGst?: number | null }): MittiElectricianResolution {
  const { legacy } = i;
  if (legacy.choice === "hivic" || legacy.choice == null) return legacy;
  if (legacy.choice === "usual" && legacy.needsProfile) return legacy;
  const name = (legacy.name ?? (legacy.choice === "usual" ? i.usual?.name : null) ?? "").trim();
  const licence = (legacy.licence ?? (legacy.choice === "usual" ? i.usual?.licence : null) ?? "").trim() || null;
  if (!name) return { ...legacy, ready: false, priceIncGst: null, reasons: legacy.reasons.length ? legacy.reasons : ["Electrician name is required"], notOnboarded: null };
  const { rec } = approvedRecFor({ name, licence }, i.candidates, i.flatPiesaIncGst ?? null);
  if (rec) return { ...legacy, ready: true, name, licence, priceIncGst: rec.piesaRateIncGst, source: "approved_rec", reasons: [], needsProfile: false, recBusinessId: rec.businessId, rateId: rec.rateId, notOnboarded: null };
  const email = legacy.choice === "usual" ? i.usual?.email ?? null : null;
  return { ...legacy, ready: false, name, licence, priceIncGst: null, reasons: [notOnboardedReason(name)], needsProfile: false, recBusinessId: null, rateId: null, notOnboarded: { name, licence, email } };
}

// ---------- ONE onboarding invite per electrician (sweep rule) ----------
export type NotOnboardedElectrician = { installerBusinessId: string; name: string; licence: string | null; email: string | null };
/** Idempotency key per electrician per installer business: licence first, then email, then the name. */
export function electricianInviteKey(e: Pick<NotOnboardedElectrician, "installerBusinessId" | "name" | "licence" | "email">): string {
  const id = normaliseLicence(e.licence) || (e.email ?? "").trim().toLowerCase() || e.name.trim().toLowerCase().replace(/\s+/g, " ");
  return `${e.installerBusinessId}:${id}`;
}

export type InviteSkip = "comms_paused" | "already_issued" | "already_onboarded" | "nomination_exists" | "no_email";
export type InviteDecision = { action: "send"; key: string } | { action: "skip"; key: string; reason: InviteSkip };

/** Whether this sweep may issue the invite now. Fails closed: paused comms, any earlier issue/attempt, or no email = skip. */
export function recInviteDecision(i: {
  electrician: NotOnboardedElectrician;
  commsEnabled: boolean;
  /** A `rec_onboarding_invite` record already exists for this key (any outcome). */
  alreadyIssued: boolean;
  /** An open nomination by this installer for the same email/licence (job_id null). */
  existingNomination: { business_id: string | null; status: string; invite_sent_at: string | null; invite_link_issued_at: string | null; attempted: boolean } | null;
}): InviteDecision {
  const key = electricianInviteKey(i.electrician);
  if (i.alreadyIssued) return { action: "skip", key, reason: "already_issued" };
  if (i.existingNomination?.business_id) return { action: "skip", key, reason: "already_onboarded" };
  if (i.existingNomination && (i.existingNomination.invite_sent_at || i.existingNomination.invite_link_issued_at || i.existingNomination.attempted || i.existingNomination.status !== "invite_pending_comms")) return { action: "skip", key, reason: "nomination_exists" };
  if (!i.electrician.email) return { action: "skip", key, reason: "no_email" };
  if (!i.commsEnabled) return { action: "skip", key, reason: "comms_paused" };
  return { action: "send", key };
}

export const INVITE_SKIP_TEXT: Record<InviteSkip, string> = {
  comms_paused: "Partner emails are paused (master switch off) — the invite goes out once they are on.",
  already_issued: "An onboarding invite was already issued to this electrician.",
  already_onboarded: "This electrician is already signed up — the quote re-checks on the next sync.",
  nomination_exists: "This electrician was already added; invitation delivery needs an office check before another send.",
  no_email: "No email on file for this electrician — the installer adds it under My business › My usual electrician.",
};

// ---------- Next-sweep outcome for a held quote (HV-3193 rule) ----------
export type HeldQuoteSweep = {
  hold: boolean; reason: string | null; resolution: MittiElectricianResolution; invite: InviteDecision | null;
  /** Always empty: the sweep never sends anything for a held quote itself. */ sends: never[];
};
/**
 * What the next Ready Check sync / tick does with a quote whose snapshot names an electrician: re-resolve against the
 * approved RECs; no match → hold "Electrician not onboarded: <name>", and the invite rule decides whether ONE invite may
 * go out (never when there is no email). Nothing else is sent. A sent/accepted quote is never touched.
 */
export function heldQuoteNextSweep(i: { quote: { status: string; sent_at?: string | null }; snapshot: MittiElectricianResolution; usual: UsualElectrician | null; candidates: ApprovedRecCandidate[]; installerBusinessId: string; commsEnabled: boolean; alreadyIssued?: boolean; existingNomination?: Parameters<typeof recInviteDecision>[0]["existingNomination"] }): HeldQuoteSweep {
  if (i.quote.status !== "draft" || i.quote.sent_at) return { hold: false, reason: null, resolution: i.snapshot, invite: null, sends: [] };
  const resolution = onboardedElectricianResolution({ legacy: { ...i.snapshot, needsProfile: false }, usual: i.usual, candidates: i.candidates });
  if (resolution.ready || !resolution.notOnboarded) return { hold: !resolution.ready, reason: resolution.ready ? null : resolution.reasons[0] ?? null, resolution, invite: null, sends: [] };
  const invite = recInviteDecision({ electrician: { installerBusinessId: i.installerBusinessId, ...resolution.notOnboarded }, commsEnabled: i.commsEnabled, alreadyIssued: !!i.alreadyIssued, existingNomination: i.existingNomination ?? null });
  return { hold: true, reason: resolution.reasons[0] ?? null, resolution, invite, sends: [] };
}
