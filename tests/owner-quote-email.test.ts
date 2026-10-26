import { expect, mock, test } from "bun:test";
import { CUSTOMER_BASE } from "../src/lib/engagement.core";
import {
  OWNER_QUOTE_EMAIL_APPROVED,
  OWNER_QUOTE_EMAIL_VERSION,
  ownerQuoteSms,
  renderOwnerQuoteEmail,
  safetyCheckPriceFromLines,
  type OwnerQuoteEmailInput,
} from "../src/lib/owner-quote-email.core";

const url = `${CUSTOMER_BASE}/my-job/tok123?screen=quote`;
const base: OwnerQuoteEmailInput = {
  firstName: "Courtney",
  address: "2A Chatfield Street, Kingsville VIC 3012",
  totalIncGst: 2347,
  rebateIncGst: 1850,
  lines: [
    {
      description: "R5.0 ceiling insulation, supplied and installed – 120 m²",
      lineTotalIncGst: 3000,
    },
    { description: "Removal of existing insulation (40 m²)", lineTotalIncGst: 150 },
    {
      description: "Electrical safety check (PIESA) by a licensed electrician",
      lineTotalIncGst: 349,
    },
    { description: "Home Insulation Victoria management and compliance", lineTotalIncGst: 349 },
  ],
  quoteUrl: url,
  validUntil: new Date("2026-11-06T12:59:59.999Z"),
  officePhone: "03 9000 0000",
  unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/unsubscribe/abc",
  safetyCheckPrice: 349,
};

test("v2 leads with the saving and says exactly what they get (Jo 24 Oct)", () => {
  const m = renderOwnerQuoteEmail({ ...base, subtotalIncGst: 4197, areaM2: 120, removalM2: 40, product: "Bradford Gold R5.0", installerName: "Reinsulate", installerCertified: true });
  expect(m.subject).toBe("Courtney, your quote is ready – save $1,850 on ceiling insulation");
  // Decision 86 design (O18): greeting, "You save" headline, price box, View and accept, itemised "Your quote", Next line.
  for (const body of [m.html, m.text]) {
    expect(body).toContain("Hi Courtney, your quote is ready.");
    expect(body).toContain("You save $1,850 on ceiling insulation");
    expect(body).toContain("$2,347.00");
    expect(body).toContain("$4,197.00"); // full price before the rebate
    expect(body).toContain("Taken off upfront. Nothing for you to claim.");
    expect(body).toContain("Measured at your Ready Check");
    expect(body).toContain("R5.0 ceiling insulation, supplied and installed – 120 m²");
    expect(body).toContain("120 m² × $25.00 per m²");
    expect(body).toContain("installed by Reinsulate, EEC-certified (AS 3999)");
    expect(body).toContain("Removal of existing insulation (40 m²)");
    expect(body).toContain("40 m² × $3.75 per m²");
    expect(body).toContain("By a licensed electrician, before any insulation goes in");
    expect(body).toContain("2A Chatfield Street, Kingsville VIC 3012");
    expect(body).toContain("Your price is held until 6 November 2026.");
    expect(body).not.toContain("call us"); expect(body).not.toContain("03 9000 0000");
    expect(body).toContain("Next:");
    expect(body).toContain("accept and pay $349.00");
    expect(body).toContain("VEU Accredited Person A003654");
    expect(body).toContain("ABN 44 671 613 979");
    expect(body).toContain("Not included: electrical fixes, only if the safety check finds any.");
    expect(body).not.toContain("Who we are"); // v3: shorter, no repeats
    expect(body).not.toMatch(/6-digit|code/i); // no signing code in the email
  }
  expect(m.html).toContain(">View and accept your quote<");
  expect(m.html).toContain(">You pay<");
  expect(m.html).toContain("−$1,850.00");
  expect(m.html).toContain(`href="${url}"`);
  expect(m.text).toContain(`View and accept your quote: ${url}`);
  expect(m.html).not.toContain("TEST — only sent to Jo");
});

test("EEC line only for an approved installer; removal only when there is removal", () => {
  const m = renderOwnerQuoteEmail({ ...base, installerName: "X", installerCertified: false, removalM2: null });
  expect(m.text).not.toContain("EEC-certified");
  expect(m.text).not.toContain("40 m² ×");
});

test("null expiry and phone drop their sentences", () => {
  const m = renderOwnerQuoteEmail({ ...base, validUntil: null, officePhone: null, safetyCheckPrice: null, unsubscribeUrl: null });
  for (const body of [m.html, m.text]) {
    expect(body).not.toContain("held until");
    expect(body).not.toContain("call us");
    expect(body).toContain("Questions? Just reply to this email.");
    expect(body).toContain("accept and pay → electrician safety check → book your install day.");
    expect(body).not.toContain("Unsubscribe");
  }
});

test("no name, no address and no rebate fall back cleanly", () => {
  const m = renderOwnerQuoteEmail({ ...base, firstName: "  ", address: null, rebateIncGst: 0 });
  expect(m.subject).toBe("Your ceiling insulation quote is ready");
  expect(m.text.startsWith("Your quote is ready.")).toBe(true);
  expect(m.text).not.toContain("VEU rebate −");
});

test("owner-supplied text is HTML-escaped", () => {
  const m = renderOwnerQuoteEmail({
    ...base,
    firstName: "<script>alert(1)</script>",
    address: `1 <b>Evil</b> St "x"`,
    lines: [{ description: "<img src=x onerror=1>", lineTotalIncGst: 10 }],
  });
  expect(m.html).not.toContain("<script>");
  expect(m.html).not.toContain("<b>Evil</b>");
  expect(m.html).not.toContain("<img src=x");
  expect(m.html).toContain("&lt;script&gt;");
  expect(m.html).toContain("1 &lt;b&gt;Evil&lt;/b&gt; St &quot;x&quot;");
});

test("refuses a bad total or non-https link", () => {
  expect(() => renderOwnerQuoteEmail({ ...base, totalIncGst: NaN })).toThrow();
  expect(() => renderOwnerQuoteEmail({ ...base, quoteUrl: "/my-job/tok" })).toThrow();
});

test("Jo approved v3 (shorter) on 24 Oct; no balance-payment line", () => {
  expect(OWNER_QUOTE_EMAIL_APPROVED).toBe(true);
  expect(OWNER_QUOTE_EMAIL_VERSION).toBe("v3-approved-2026-10-24");
  expect(renderOwnerQuoteEmail(base).text).not.toMatch(/balance|two halves/i);
});

test("TEST pill only when asked", () => {
  expect(renderOwnerQuoteEmail({ ...base, test: true }).html).toContain("TEST — only sent to Jo");
});

test("SMS is the approved quote-ready text (decision 87, B); the sender adds the brand prefix", () => {
  expect(ownerQuoteSms("Courtney", url)).toBe(`Your ceiling insulation quote is ready, Courtney. See it here: ${url} Reply STOP to opt out.`);
  expect(ownerQuoteSms(null, url)).toBe(`Your ceiling insulation quote is ready. See it here: ${url} Reply STOP to opt out.`);
  expect(ownerQuoteSms("Courtney", url)).not.toMatch(/\$\d/);
});

test("safety check price is taken only from one unambiguous line", () => {
  expect(safetyCheckPriceFromLines(base.lines)).toBe(349);
  expect(safetyCheckPriceFromLines([{ description: "Install", lineTotalIncGst: 5 }])).toBeNull();
});

// --- notifyOwnerQuoteReady on a qa_test job sends the rendered email through sendTestEmail ---
const sentEmails: { to: string; subject: string; html: string; text: string }[] = [];
const sentSms: string[] = [];
mock.module("../src/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const rows: Record<string, unknown> = {
        jobs: {
          source: "qa_test",
          owner_id: "o",
          property_id: "p",
          job_number: "HV-TEST",
          stage: "ready_check_scheduled",
        },
        owners: {
          email: "jolowexo@hotmail.com",
          phone: "0477511901",
          full_name: "Courtney Daniels",
        },
        quotes: {
          customer_total_inc_gst: 2347,
          veec_discount_inc_gst: 1850,
          sent_at: "2026-10-23T01:00:00Z",
          kind: "installation",
        },
        customer_estimate_links: {
          token: "test-token",
          status: "active",
          expires_at: "2099-01-01",
        },
        properties: { address_line: "2A Chatfield Street", suburb: "Kingsville", postcode: "3012" },
        job_assignments: { business_id: "b" },
        businesses: { onboarding_notes: "[TEST PARTNER]" },
      };
      const list =
        table === "quote_items"
          ? [
              { description: "Removal", line_total_inc_gst: 150, sort: 2 },
              { description: "R5.0 install", line_total_inc_gst: 3000, sort: 1 },
            ]
          : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable query stub
      const q: any = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[table] ?? null, error: null });
        },
        then(res: (v: unknown) => unknown) {
          return Promise.resolve({ data: list, error: null }).then(res);
        },
      };
      return q;
    },
  },
}));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async () => {} }));
mock.module("../src/lib/emailsafety.server", () => ({
  unsubscribeUrlForJob: async () => "https://estimate.homeinsulationvictoria.com.au/unsubscribe/t",
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_ctx: unknown, to: string, subject: string, html: string, text: string) => {
    sentEmails.push({ to, subject, html, text });
    return { status: "sent", detail: "TEST accepted" };
  },
  sendTestSms: async (_ctx: unknown, _to: string, body: string) => {
    sentSms.push(body);
    return { status: "sent", detail: "TEST accepted" };
  },
}));
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async () => {
    throw Error("Real sender must not be entered");
  },
}));

test("qa_test notify sends the rendered owner quote email via sendTestEmail", async () => {
  const { notifyOwnerQuoteReady } = await import("../src/lib/quote-ready-notify.server");
  const r = await notifyOwnerQuoteReady("j", "q", "installation");
  expect(r).toEqual({ email: "sent: TEST accepted", sms: "sent: TEST accepted" });
  expect(sentEmails).toHaveLength(1);
  const m = sentEmails[0]!;
  expect(m.subject).toMatch(/^Courtney, your quote is ready/);
  expect(m.html).toContain(`href="${CUSTOMER_BASE}/my-job/test-token?screen=quote"`);
  expect(m.text).toContain("2A Chatfield Street, Kingsville VIC 3012");
  expect(m.text).toContain("$2,347.00");
  expect(m.html).toContain("TEST — only sent to Jo");
  expect(sentSms[0]).toBe(`Your ceiling insulation quote is ready, Courtney. See it here: ${CUSTOMER_BASE}/my-job/test-token?screen=quote Reply STOP to opt out.`); // decision 87, B
  expect(sentSms[0]).toContain(`${CUSTOMER_BASE}/my-job/test-token?screen=quote`);
});

test("Jo 24 Oct (decision 86): fixes are quoted separately, nothing done without the owner's OK", () => {
  for (const body of [renderOwnerQuoteEmail(base).html, renderOwnerQuoteEmail(base).text]) {
    expect(body).toContain("Quoted separately, nothing done without your OK.");
  }
});

test("quote reminders (decisions 88/89/134): reminder line, price box, button, no breakdown; approved", async () => {
  const { renderQuoteReminderEmail, QUOTE_REMINDER_EMAIL_APPROVED } = await import("../src/lib/owner-quote-email.core");
  const day3 = renderQuoteReminderEmail({ ...base, subtotalIncGst: 4197, kind: "day3" });
  expect(day3.subject).toBe("Courtney, your quote is waiting");
  expect(day3.html).toContain("Just checking you saw it.");
  expect(day3.html).toContain("Your $1,850 rebate is ready to go,");
  expect(day3.html).toContain("held until <strong>6 November</strong>");
  expect(day3.html).toContain(">View and accept your quote<");
  expect(day3.html).not.toContain("Your quote</div>");
  const expiry = renderQuoteReminderEmail({ ...base, subtotalIncGst: 4197, kind: "expiry" });
  expect(expiry.subject).toBe("Courtney, your quote price is held until 6 November");
  expect(expiry.text).toContain("Accept by then to keep your price with $1,850 off.");
  expect(QUOTE_REMINDER_EMAIL_APPROVED).toBe(true); // decisions 89/134
});
