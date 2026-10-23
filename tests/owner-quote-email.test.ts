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

test("numbers, lines, link and address appear in html and text", () => {
  const m = renderOwnerQuoteEmail(base);
  expect(m.subject).toBe("Your ceiling insulation quote is ready, Courtney");
  for (const body of [m.html, m.text]) {
    expect(body).toContain("$2,347.00");
    expect(body).toContain("$1,850.00");
    expect(body).toContain("$3,000.00");
    expect(body).toContain("$150.00");
    expect(body).toContain("Removal of existing insulation (40 m²)");
    expect(body).toContain("Government VEU rebate – minus $1,850.00");
    expect(body).toContain("2A Chatfield Street, Kingsville VIC 3012");
    expect(body).toContain("tok123?screen=quote");
    expect(body).toContain("6 November 2026");
    expect(body).toContain("call us on 03 9000 0000");
    expect(body).toContain("You pay the $349.00 electrical safety check.");
  }
  expect(m.html).toContain(`href="${url}"`);
  expect(m.text).toContain(`View and accept your quote: ${url}`);
  expect(m.text).toContain(
    "Unsubscribe: https://estimate.homeinsulationvictoria.com.au/unsubscribe/abc",
  );
  expect(m.html).not.toContain("TEST — only sent to Jo");
});

test("null expiry and phone drop their sentences", () => {
  const m = renderOwnerQuoteEmail({
    ...base,
    validUntil: null,
    officePhone: null,
    safetyCheckPrice: null,
    unsubscribeUrl: null,
  });
  for (const body of [m.html, m.text]) {
    expect(body).not.toContain("valid until");
    expect(body).not.toContain("call us");
    expect(body).toContain("Questions? Just reply to this email.");
    expect(body).toContain("You pay the electrical safety check.");
    expect(body).not.toContain("Unsubscribe");
  }
});

test("no name, no address and no rebate fall back cleanly", () => {
  const m = renderOwnerQuoteEmail({ ...base, firstName: "  ", address: null, rebateIncGst: 0 });
  expect(m.subject).toBe("Your ceiling insulation quote is ready");
  expect(m.text).toContain("Hi there,");
  expect(m.text).toContain(
    "Thanks for having us out for your free Ready Check. Your ceiling insulation quote is ready.",
  );
  expect(m.text).toContain("(including GST).");
  expect(m.text).not.toContain("VEU rebate");
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

test("wording is not approved yet", () => {
  expect(OWNER_QUOTE_EMAIL_APPROVED).toBe(false);
  expect(OWNER_QUOTE_EMAIL_VERSION).toBe("v1-draft");
});

test("TEST pill only when asked", () => {
  expect(renderOwnerQuoteEmail({ ...base, test: true }).html).toContain("TEST — only sent to Jo");
});

test("SMS follows the draft wording", () => {
  expect(ownerQuoteSms("Courtney", "$2,347.00", url)).toBe(
    `Hi Courtney, your Home Insulation Victoria ceiling insulation quote is ready: $2,347.00 after the VEU rebate. View and accept here: ${url}. Reply STOP to opt out.`,
  );
  expect(ownerQuoteSms(null, "$1.00", url)).toStartWith("Hi there,");
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
  expect(m.subject).toBe("Your ceiling insulation quote is ready, Courtney");
  expect(m.html).toContain(`href="${CUSTOMER_BASE}/my-job/test-token?screen=quote"`);
  expect(m.text).toContain("2A Chatfield Street, Kingsville VIC 3012");
  expect(m.text.indexOf("R5.0 install")).toBeLessThan(m.text.indexOf("Removal"));
  expect(m.text).toContain("$2,347.00");
  expect(m.html).toContain("TEST — only sent to Jo");
  expect(sentSms[0]).toContain("$2,347.00 after the VEU rebate");
  expect(sentSms[0]).toContain(`${CUSTOMER_BASE}/my-job/test-token?screen=quote`);
});
