import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { CUSTOMER_BASE, PIXEL_GIF, clickUrl, dedupe, estimateUrl, newTrackingToken, pixelResponse, pixelToken, pixelUrl, planFollowup, planInitialFollowups, redirectResponse, safeMetadata, sendBlocker, summarize, threeDayKind, type EngagementEvent } from "../src/lib/engagement.core";
import { base44BridgeConfig } from "../src/lib/delivery.core";
import { renderEstimateEmail } from "../src/lib/estimate-email";
import { renderFollowupEmail } from "../src/lib/followup-email";

const T0 = Date.parse("2026-10-01T00:00:00Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const ev = (event_type: string, ms: number, metadata?: Record<string, unknown>): EngagementEvent => ({ event_type, occurred_at: at(ms), metadata: metadata ?? null });
const allGates = { commsEnabled: true, consent: true, activeLink: true, eligibilityOk: true, providerConfigured: true };
const src = (p: string) => readFileSync(p, "utf8");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const JOB_ID = "7f1c2b9e-1111-4222-8333-944455556666";

describe("tracking tokens and URLs", () => {
  test("opaque, 256-bit, never a job id or PII", () => {
    const a = newTrackingToken(), b = newTrackingToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(clickUrl(a)).not.toContain(JOB_ID);
    expect(clickUrl(a)).toBe(`${CUSTOMER_BASE}/t/e/${a}`);
    expect(pixelUrl(a)).toBe(`${CUSTOMER_BASE}/t/o/${a}.gif`);
    expect(pixelToken(`${a}.gif`)).toBe(a);
    expect(pixelToken("abc.gif")).toBeNull();
    expect(pixelToken(`${a}.png`)).toBeNull();
  });
  test("metadata whitelist drops PII", () => {
    expect(safeMetadata({ email: "x@y.com", name: "Jo", phone: "04", area_band: "150-199", prefetch_suspected: true })).toEqual({ area_band: "150-199", prefetch_suspected: true });
  });
  test("customer URLs never expose lovable.app", () => {
    for (const u of [clickUrl(newTrackingToken()), pixelUrl(newTrackingToken()), estimateUrl(newTrackingToken())]) expect(u).not.toContain("lovable.app");
  });
});

describe("pixel + redirect responses", () => {
  test("pixel is a no-store 1x1 gif", async () => {
    const r = pixelResponse();
    expect(r.headers.get("Content-Type")).toBe("image/gif");
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(r.headers.get("Cache-Control")).toContain("private");
    const b = new Uint8Array(await r.arrayBuffer());
    expect(String.fromCharCode(...b.slice(0, 6))).toBe("GIF89a");
    expect(b.length).toBe(PIXEL_GIF.length);
  });
  test("HEAD returns no body", async () => { expect((await pixelResponse("HEAD").arrayBuffer()).byteLength).toBe(0); });
  test("click redirect is a 302, no-store", () => {
    const r = redirectResponse("/estimate/abc");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/estimate/abc");
    expect(r.headers.get("Cache-Control")).toContain("no-store");
  });
  test("click route logs before redirecting; pixel route never counts HEAD", () => {
    const click = src("src/routes/t.e.$token.ts");
    expect(click.indexOf("resolveClick")).toBeLessThan(click.indexOf("redirectResponse(to)"));
    const s = src("src/lib/engagement.server.ts");
    const rc = s.slice(s.indexOf("export async function resolveClick"), s.indexOf("export async function recordOpen"));
    expect(rc.indexOf("email_clicked")).toBeLessThan(rc.indexOf("return l && linkUsable"));
    const pix = src("src/routes/t.o.$file.ts");
    const head = pix.slice(pix.indexOf("HEAD:"));
    expect(head).not.toContain("recordOpen");
  });
});

describe("dedupe keys bound repeats", () => {
  test("opens/clicks/views collapse within the hour; calculator within the day", () => {
    expect(dedupe.open("t", T0)).toBe(dedupe.open("t", T0 + 59 * 60_000));
    expect(dedupe.open("t", T0)).not.toBe(dedupe.open("t", T0 + 61 * 60_000));
    expect(dedupe.click("t", T0)).toBe(dedupe.click("t", T0 + 1000));
    expect(dedupe.view("l", T0)).toBe(dedupe.view("l", T0 + 1000));
    expect(dedupe.calc("l", T0)).toBe(dedupe.calc("l", T0 + 12 * 3_600_000));
    expect(dedupe.bookingCompleted("j")).toBe(dedupe.bookingCompleted("j"));
  });
  test("estimate view and calculator use are logged server-side with dedupe", () => {
    const s = src("src/lib/engagement.server.ts");
    expect(s).toMatch(/type: "estimate_viewed".*dedupe\.view/);
    expect(s).toMatch(/type: "calculator_used".*dedupe\.calc/);
    expect(src("src/lib/estimatelink.server.ts")).toContain("recordEstimateView(l.job_id, l.id)");
    const calc = src("src/components/portal/estimate.tsx");
    expect(calc).toContain("reported.current = true");
    expect(calc).toContain("setTimeout");
  });
});

describe("engagement summary", () => {
  test("tiers: strong signals override weak open", () => {
    expect(summarize([]).tier).toBe("no_email");
    expect(summarize([ev("email_sent", 0)]).tier).toBe("sent_unopened");
    expect(summarize([ev("email_sent", 0), ev("email_opened", 3_600_000)]).tier).toBe("opened");
    expect(summarize([ev("email_sent", 0), ev("email_clicked", 10)]).tier).toBe("clicked");
    expect(summarize([ev("email_sent", 0), ev("estimate_viewed", 10)]).tier).toBe("estimate_viewed");
    expect(summarize([ev("email_sent", 0), ev("estimate_viewed", 10), ev("calculator_used", 20)]).tier).toBe("calculator_engaged");
    expect(summarize([ev("email_sent", 0), ev("booking_completed", 20)]).tier).toBe("booked");
  });
  test("prefetch-window open is not reliable", () => {
    expect(summarize([ev("email_sent", 0), ev("email_opened", 30_000)]).reliableOpen).toBe(false);
    expect(summarize([ev("email_sent", 0), ev("email_opened", 3_600_000, { prefetch_suspected: true })]).reliableOpen).toBe(false);
    expect(summarize([ev("email_sent", 0), ev("email_opened", 3_600_000)]).reliableOpen).toBe(true);
  });
});

describe("follow-ups", () => {
  const sent = summarize([ev("email_sent", 0)]);
  test("initial send creates 3d + 7d; none when booked", () => {
    const p = planInitialFollowups(at(0), sent);
    expect(p.map((x) => x.slot)).toEqual(["3d", "7d"]);
    expect(Date.parse(p[0]!.due_at) - T0).toBe(3 * 86_400_000);
    expect(Date.parse(p[1]!.due_at) - T0).toBe(7 * 86_400_000);
    expect(planInitialFollowups(at(0), summarize([ev("email_sent", 0), ev("booking_completed", 1)]))).toEqual([]);
  });
  test("3-day branch: unopened vs engaged", () => {
    expect(threeDayKind(sent)).toBe("estimate_unopened_3d");
    expect(threeDayKind(summarize([ev("email_sent", 0), ev("email_opened", 20_000)]))).toBe("estimate_unopened_3d"); // prefetch only
    expect(threeDayKind(summarize([ev("email_sent", 0), ev("email_opened", 3_600_000)]))).toBe("estimate_engaged_no_booking_3d");
    expect(threeDayKind(summarize([ev("email_sent", 0), ev("estimate_viewed", 10)]))).toBe("estimate_engaged_no_booking_3d");
  });
  const row3 = { slot: "3d" as const, kind: "estimate_unopened_3d" as const, status: "queued", due_at: at(3 * 86_400_000) };
  const row7 = { slot: "7d" as const, kind: "estimate_second_reminder_7d" as const, status: "queued", due_at: at(7 * 86_400_000) };
  test("booking suppresses; 7d sends second reminder; stale reminders suppressed", () => {
    const booked = summarize([ev("email_sent", 0), ev("booking_completed", 10)]);
    expect(planFollowup(row3, booked, allGates, T0 + 3 * 86_400_000)).toEqual({ action: "suppress", reason: "booking_completed" });
    expect(planFollowup(row7, booked, allGates, T0 + 7 * 86_400_000)).toEqual({ action: "suppress", reason: "booking_completed" });
    expect(planFollowup(row7, sent, allGates, T0 + 7 * 86_400_000)).toEqual({ action: "send", kind: "estimate_second_reminder_7d" });
    expect(planFollowup(row7, sent, allGates, T0 + 15 * 86_400_000)).toEqual({ action: "suppress", reason: "expired_unsent" });
    expect(planFollowup({ ...row3, status: "sent" }, sent, allGates)).toEqual({ action: "suppress", reason: "already_final" });
  });
  test("gates are rechecked at send time; missing provider never marks sent", () => {
    const now = T0 + 3 * 86_400_000;
    expect(planFollowup(row3, sent, { ...allGates, commsEnabled: false }, now)).toEqual({ action: "block", reason: "comms_disabled" });
    expect(planFollowup(row3, sent, { ...allGates, consent: false }, now)).toEqual({ action: "block", reason: "no_contact_consent" });
    expect(planFollowup(row3, sent, { ...allGates, activeLink: false }, now)).toEqual({ action: "block", reason: "no_active_estimate_link" });
    expect(planFollowup(row3, sent, { ...allGates, providerConfigured: false }, now)).toEqual({ action: "block", reason: "delivery_not_configured" });
    expect(planFollowup(row3, sent, { ...allGates, eligibilityOk: false }, now)).toEqual({ action: "suppress", reason: "eligibility_not_permitted" });
    expect(sendBlocker({ ...allGates, alreadySent: true })).toBe("already_sent");
    expect(sendBlocker({ ...allGates, alreadySent: false })).toBeNull();
  });
  test("idempotency: unique job+slot, job+kind, send keys; followups suppressed on booking", () => {
    const m = src("drizzle/migrations/0036_customer_engagement_followups.sql");
    expect(m).toContain("UNIQUE (job_id, slot)");
    expect(m).toContain("UNIQUE (job_id, kind)");
    expect(m).toContain("idempotency_key text NOT NULL UNIQUE");
    expect(m).toContain("FOR UPDATE SKIP LOCKED");
    const f = src("src/lib/followups.server.ts");
    expect(f).toContain('onConflict: "job_id,slot", ignoreDuplicates: true');
    expect(f).toContain("key: `followup:${f.id}`");
    const s = src("src/lib/engagement.server.ts");
    const done = s.slice(s.indexOf("export async function recordBookingCompleted"));
    expect(done).toContain("suppressFollowups(jobId");
    expect(src("src/lib/booking.server.ts")).toContain("recordBookingCompleted(jobId)");
  });
  test("provider only marks sent after a successful deliver()", () => {
    const f = src("src/lib/followups.server.ts");
    const d = f.slice(f.indexOf("async function deliverTracked"));
    expect(d.indexOf("adapter.deliver(")).toBeLessThan(d.indexOf('status: "sent"'));
  });
});

describe("delivery configuration", () => {
  test("bridge requires enabled row, https URL and secret", () => {
    const ok = { endpoint_url: "https://x/hook", hmac_secret: "s".repeat(40), enabled: true };
    expect(base44BridgeConfig(null)).toBeNull();
    expect(base44BridgeConfig({ ...ok, hmac_secret: null })).toBeNull();
    expect(base44BridgeConfig({ ...ok, endpoint_url: "http://x/hook" })).toBeNull();
    expect(base44BridgeConfig({ ...ok, enabled: false })).toBeNull();
    expect(base44BridgeConfig(ok)).not.toBeNull();
  });
  test("no Resend anywhere in src", () => {
    for (const f of walk("src")) if (/\.(ts|tsx)$/.test(f)) expect(src(f)).not.toMatch(/from ["']resend["']|api\.resend\.com|RESEND_API_KEY|new Resend\(/);
  });
});

describe("email renderers", () => {
  const link = `${CUSTOMER_BASE}/estimate/${newTrackingToken()}`;
  const tok = newTrackingToken();
  const quote = { estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1 };
  test("tracked CTA + pixel only when supplied", () => {
    const plain = renderEstimateEmail({ estimateUrl: link, ...quote });
    expect(plain.html).toContain(`href="${link}#confirm"`);
    expect(plain.html).not.toContain("/t/o/");
    const tracked = renderEstimateEmail({ estimateUrl: link, trackingClickUrl: clickUrl(tok), trackingPixelUrl: pixelUrl(tok), ...quote });
    expect(tracked.html).toContain(`href="${clickUrl(tok)}"`);
    expect(tracked.html).toContain(`src="${pixelUrl(tok)}"`);
    expect(tracked.plainText).toContain(clickUrl(tok));
    expect(() => renderEstimateEmail({ estimateUrl: link, trackingClickUrl: "https://evil.example/t/e/x", ...quote })).toThrow();
  });
  test("follow-ups: branded, same domain, $349 included, no provider branding", () => {
    for (const kind of ["estimate_unopened_3d", "estimate_engaged_no_booking_3d", "estimate_second_reminder_7d"] as const) {
      const m = renderFollowupEmail({ kind, estimateUrl: link, trackingClickUrl: clickUrl(tok), trackingPixelUrl: pixelUrl(tok) });
      expect(m.html).toContain("#3C51C4");
      expect(m.html).toContain(clickUrl(tok));
      expect(m.html).not.toMatch(/lovable\.app|<script|\bresend\b/i);
      expect(m.plainText).toContain(clickUrl(tok));
    }
    expect(renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl: link }).subject).toContain("Just checking you received your Home Insulation Victoria estimate");
    expect(renderFollowupEmail({ kind: "estimate_engaged_no_booking_3d", estimateUrl: link }).html).toContain("Ready for us to confirm your estimate onsite?");
    expect(renderFollowupEmail({ kind: "estimate_engaged_no_booking_3d", estimateUrl: link }).plainText).toContain("$349 payable now for the Measure + PIESA. Already included in your estimated total — not an extra fee.");
    const seven = renderFollowupEmail({ kind: "estimate_second_reminder_7d", estimateUrl: link }).plainText;
    expect(seven).toContain("Warmer in winter");
    expect(seven).toContain("Transparent HI VIC pricing");
  });
  test("sample preview never calls live tracking", () => {
    const p = src("src/routes/step3-email-preview.tsx");
    expect(p).not.toMatch(/tracking(Click|Pixel)Url|\/t\/e\/|\/t\/o\//);
  });
});
