// Step 3 customer engagement + follow-up rules. Pure: no I/O, no delivery.
// Opens are a WEAK signal (mailbox privacy features prefetch pixels); click/view/calculator/booking are strong.
import { newToken, isWellFormedToken } from "./estimatelink.core";

export const CUSTOMER_BASE = "https://estimate.homeinsulationvictoria.com.au";
/** Decision 387 (Jo 25 Oct 2026): every NEW enquirer (no job yet) is sent to the website's homeowner enquiry page, never the calculator. */
export const HOMEOWNER_ENQUIRY_URL = "https://homeinsulationvictoria.com.au/homeowner";
export const TRACKING_TTL_DAYS = 60;
export const PREFETCH_WINDOW_MS = 2 * 60_000; // opens this soon after send are treated as likely privacy prefetch
export const FOLLOWUP_3D_MS = 3 * 86_400_000;
export const FOLLOWUP_STALE_MS = 7 * 86_400_000; // never send a reminder more than 7 days late
export const OPEN_PRIVACY_NOTE = "Email opens can be affected by mailbox privacy features; clicks and estimate activity are stronger signals.";

export type EventType = "email_sent" | "email_delivered" | "email_opened" | "email_clicked" | "estimate_viewed" | "calculator_used" | "booking_started" | "booking_completed" | "followup_queued" | "followup_sent" | "followup_suppressed" | "email_bounced" | "email_failed" | "opted_out";
export type EngagementEvent = { event_type: EventType | string; occurred_at: string; metadata?: Record<string, unknown> | null };
export type Tier = "no_email" | "sent_unopened" | "opened" | "clicked" | "estimate_viewed" | "calculator_engaged" | "booked";
export type ActiveFollowupKind = "estimate_unopened_3d";
/** Retained only to recognize and suppress historical queue rows. */
export type RetiredFollowupKind = "estimate_engaged_no_booking_3d" | "estimate_second_reminder_7d";
export type FollowupKind = ActiveFollowupKind | RetiredFollowupKind;
export const isActiveFollowupKind = (kind: string): kind is ActiveFollowupKind => kind === "estimate_unopened_3d";

export const newTrackingToken = newToken;
export const isTrackingToken = isWellFormedToken;
export const clickUrl = (token: string) => `${CUSTOMER_BASE}/t/e/${token}`;
export const pixelUrl = (token: string) => `${CUSTOMER_BASE}/t/o/${token}.gif`;
export const estimateUrl = (linkToken: string) => `${CUSTOMER_BASE}/estimate/${linkToken}`;

/** Parses "<token>.gif" from the pixel path segment. */
export function pixelToken(file: string): string | null {
  const m = /^([A-Za-z0-9_-]+)\.gif$/.exec(file);
  return m && isTrackingToken(m[1]) ? m[1]! : null;
}

const hour = (at: Date | number) => new Date(at).toISOString().slice(0, 13);
/** Dedupe keys: bounded repeats instead of runaway duplicates. */
export const dedupe = {
  open: (tokenId: string, at: Date | number = Date.now()) => `open:${tokenId}:${hour(at)}`,
  click: (tokenId: string, at: Date | number = Date.now()) => `click:${tokenId}:${hour(at)}`,
  view: (linkId: string, at: Date | number = Date.now()) => `view:${linkId}:${hour(at)}`,
  sent: (key: string) => `sent:${key}`,
  bookingStarted: (jobId: string) => `booking_started:${jobId}`,
  bookingCompleted: (jobId: string) => `booking_completed:${jobId}`,
  followup: (followupId: string, what: string) => `followup:${followupId}:${what}`,
};

/** Safe metadata only: whitelisted non-PII keys. */
const META_KEYS = new Set(["kind", "slot", "area_band", "purpose", "reason", "ua_class", "prefetch_suspected", "booking_kind", "provider", "status", "followup_kind"]);
export function safeMetadata(m: Record<string, unknown> = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(m)) if (META_KEYS.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) out[k] = typeof v === "string" ? v.slice(0, 80) : v;
  return out;
}
export function uaClass(ua: string | null): string {
  if (!ua) return "unknown";
  if (/GoogleImageProxy/i.test(ua)) return "gmail_proxy";
  if (/YahooMailProxy/i.test(ua)) return "yahoo_proxy";
  return "client";
}

export type Summary = {
  lastEmailSent: string | null; firstOpen: string | null; lastOpen: string | null; reliableOpen: boolean;
  firstClick: string | null; lastClick: string | null; firstView: string | null; lastView: string | null;
  firstCalc: string | null; lastCalc: string | null; bookingStarted: string | null; bookingCompleted: string | null; tier: Tier;
};

export function summarize(events: EngagementEvent[]): Summary {
  const sorted = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const of = (t: string) => sorted.filter((e) => e.event_type === t).map((e) => e.occurred_at);
  const first = (t: string) => of(t)[0] ?? null;
  const last = (t: string) => of(t).at(-1) ?? null;
  const sends = of("email_sent");
  const firstSend = sends[0] ? Date.parse(sends[0]) : null;
  const opens = sorted.filter((e) => e.event_type === "email_opened");
  const reliableOpen = opens.some((o) => o.metadata?.["prefetch_suspected"] !== true && (firstSend == null || Date.parse(o.occurred_at) - firstSend > PREFETCH_WINDOW_MS));
  const s: Omit<Summary, "tier"> = {
    lastEmailSent: sends.at(-1) ?? null, firstOpen: first("email_opened"), lastOpen: last("email_opened"), reliableOpen,
    firstClick: first("email_clicked"), lastClick: last("email_clicked"), firstView: first("estimate_viewed"), lastView: last("estimate_viewed"),
    firstCalc: first("calculator_used"), lastCalc: last("calculator_used"), bookingStarted: first("booking_started"), bookingCompleted: first("booking_completed"),
  };
  return { ...s, tier: tierOf(s) };
}

/** Strong signals override weak ones; open alone never outranks click/view/calculator. */
export function tierOf(s: Omit<Summary, "tier">): Tier {
  if (s.bookingCompleted) return "booked";
  if (s.firstCalc) return "calculator_engaged";
  if (s.firstView) return "estimate_viewed";
  if (s.firstClick) return "clicked";
  if (s.firstOpen) return "opened";
  if (s.lastEmailSent) return "sent_unopened";
  return "no_email";
}

export const strongEngagement = (s: Summary) => !!(s.firstClick || s.firstView || s.firstCalc);

/** One unopened follow-up after a successful initial send; none when already booked. */
export function planInitialFollowups(sentAt: string, s: Summary) {
  if (s.bookingCompleted) return [];
  const t = Date.parse(sentAt);
  return [{ slot: "3d" as const, kind: "estimate_unopened_3d" as ActiveFollowupKind, due_at: new Date(t + FOLLOWUP_3D_MS).toISOString() }];
}

export type SendGates = { commsEnabled: boolean; consent: boolean; activeLink: boolean; eligibilityOk: boolean; providerConfigured: boolean; alreadySent: boolean };
/** First blocker wins; null = allowed to call the provider. */
export function sendBlocker(g: SendGates): string | null {
  if (g.alreadySent) return "already_sent";
  if (!g.commsEnabled) return "comms_disabled";
  if (!g.consent) return "no_contact_consent";
  if (!g.activeLink) return "no_active_estimate_link";
  if (!g.eligibilityOk) return "eligibility_not_permitted";
  if (!g.providerConfigured) return "delivery_not_configured";
  return null;
}

export type FollowupRow = { slot: "3d" | "7d"; kind: FollowupKind; status: string; due_at: string };
export type FollowupPlan = { action: "suppress"; reason: string } | { action: "block"; reason: string } | { action: "send"; kind: ActiveFollowupKind };
export function planFollowup(f: FollowupRow, s: Summary, g: Omit<SendGates, "alreadySent">, now = Date.now()): FollowupPlan {
  if (f.status === "sent" || f.status === "suppressed") return { action: "suppress", reason: "already_final" };
  if (f.slot !== "3d" || !isActiveFollowupKind(f.kind)) return { action: "suppress", reason: "retired_followup_kind" };
  if (s.bookingCompleted) return { action: "suppress", reason: "booking_completed" };
  if (strongEngagement(s) || s.reliableOpen) return { action: "suppress", reason: "estimate_already_engaged" };
  if (!g.eligibilityOk) return { action: "suppress", reason: "eligibility_not_permitted" };
  if (now - Date.parse(f.due_at) > FOLLOWUP_STALE_MS) return { action: "suppress", reason: "expired_unsent" };
  const b = sendBlocker({ ...g, alreadySent: false });
  if (b) return { action: "block", reason: b };
  return { action: "send", kind: "estimate_unopened_3d" };
}

/** Retry schedule for blocked/failed attempts: capped exponential backoff, deterministic for auditability. */
export function retryAt(now = Date.now(), attempts = 0) {
  const hours = Math.min(24, 2 ** Math.max(0, Math.min(5, attempts)));
  return new Date(now + hours * 3_600_000).toISOString();
}

/** 1x1 transparent GIF. */
export const PIXEL_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
export function pixelResponse(method = "GET"): Response {
  return new Response(method === "HEAD" ? null : PIXEL_GIF, { status: 200, headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
}
export function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
}
