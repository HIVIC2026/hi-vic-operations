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
    expect(body).toContain("Not included: electrical upgrades, only if the electrical safety check (PIESA) finds any.");
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

test("quote price cells, including You pay, keep a 110px minimum width and do not break words", () => {
  const { html } = renderOwnerQuoteEmail(base);
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((match) => match[1] ?? "")
    .filter((row) => /<td\b[^>]*align="right"/.test(row));
  expect(rows).toHaveLength(base.lines.length + 3); // Full price, VEU rebate, You pay.
  expect(rows.some((row) => row.includes("<strong>You pay</strong>"))).toBe(true);
  for (const row of rows) {
    const priceCell = row.match(/<td\b[^>]*align="right"[^>]*>/)?.[0] ?? "";
    expect(priceCell).toContain('width="110"');
    expect(priceCell).toContain("min-width:110px;");
    expect(priceCell).toContain("word-break:keep-all;");
    expect(priceCell).toContain("white-space:nowrap;");
    expect(priceCell).toContain("overflow-wrap:normal;");
    expect(priceCell).toContain("word-wrap:normal;");
  }
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
    expect(body).toContain("Your electrician quotes these directly, and nothing is done without your OK.");
  }
});

test("quote reminders (decisions 88/89/134): reminder line, price box, button, no breakdown; approved", async () => {
  const { renderQuoteReminderEmail, QUOTE_REMINDER_EMAIL_APPROVED } = await import("../src/lib/owner-quote-email.core");
  const day3 = renderQuoteReminderEmail({ ...base, subtotalIncGst: 4197, kind: "day3" });
  expect(day3.subject).toBe("Courtney, your quote is waiting");
  expect(day3.html).toContain("Just checking you saw it.");
  expect(day3.html).toContain("Your $1,850 rebate is ready to go,");
  expect(day3.html).toContain("held until 6 November.");
  expect(day3.html).toContain(">View and accept your quote<");
  expect(day3.html).not.toContain("Your quote</div>");
  const expiry = renderQuoteReminderEmail({ ...base, subtotalIncGst: 4197, kind: "expiry" });
  expect(expiry.subject).toBe("Courtney, your quote price is held until 6 November");
  expect(expiry.text).toContain("Accept by then to keep your price with $1,850 off.");
  expect(QUOTE_REMINDER_EMAIL_APPROVED).toBe(true); // decisions 89/134
});

/* ---------------------------------------------------------------- Part 10 Task 5: own-customer quote email (co-branded) */
import { OWN_CUSTOMER_COBRAND_APPROVED } from "../src/lib/cobrand.core";
import { VEU_BOX_TEXT, VEU_BOX_LINK, VEU_FACTSHEET_URL } from "../src/lib/owner-wording.core";

const ownInput: OwnerQuoteEmailInput = {
  firstName: "Sarah", address: "12 Example St, Box Hill VIC 3128", totalIncGst: 2098, rebateIncGst: 600, subtotalIncGst: 2698,
  lines: [
    { code: "INSTALLER_PRICE", description: "Insulation works by your installer — includes: Ceiling insulation - supply & install", lineTotalIncGst: 2000 },
    { code: "AP_FEE", description: "Home Insulation Victoria fee", lineTotalIncGst: 349 },
    { code: "PIESA", description: "Electrical safety check (PIESA)", lineTotalIncGst: 349 },
  ],
  quoteUrl: url, validUntil: new Date("2026-12-04T12:59:59.999Z"), validDays: 30, officePhone: null,
  unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/unsubscribe/abc", safetyCheckPrice: 349, areaM2: 120, product: "Bradford Gold R5.0",
  installerName: "Rapid Insulation", installerCertified: true, v4: true, changes: [],
  ownCustomer: { installerName: "Rapid Insulation", installerLogoUrl: "https://x/rapid-logo.png" },
};
const on = { cobrandApproved: true };
const render = (i: OwnerQuoteEmailInput, seam = on) => renderOwnerQuoteEmail(i, seam);
/** Row titles in the plain-text "YOUR QUOTE" block (title, then optional " (detail)", then ": amount"). */
const rowTitles = (text: string) => {
  const block = text.slice(text.indexOf("YOUR QUOTE")).split("\n").slice(1);
  const out: string[] = [];
  for (const l of block) { if (!l.trim()) break; out.push(l.replace(/: [−$].*$/, "").replace(/^Insulation \(.*\)$/, "Insulation")); }
  return out;
};
const withoutOwn = (i: OwnerQuoteEmailInput): OwnerQuoteEmailInput => { const { ownCustomer: _o, ...rest } = i; return rest; };

test("Task 5: own-customer quote email (approved on) — approved lines by code, both logos, VEU box", () => {
  const m = render(ownInput);
  expect(rowTitles(m.text)).toEqual(["Insulation", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Rebate", "Your price"]);
  expect(m.text).toContain("Rebate: −$600.00");
  expect(m.text).toContain("Your price: $2,098.00");
  expect(m.text).toContain("Insulation (Insulation works by your installer — includes: Ceiling insulation - supply & install): $2,000.00");
  expect(m.text).not.toMatch(/Home Insulation Victoria fee \(VEU-approved/); // rows come from the code, never a description regex
  expect(m.text).not.toContain("You pay:");
  expect(m.text).not.toContain("Full price");
  expect(m.text).toContain(`About the Victorian Energy Upgrades program — ${VEU_BOX_TEXT}`);
  expect(m.text).toContain(VEU_BOX_LINK);
  expect(m.html).toContain(VEU_FACTSHEET_URL);
  expect(m.html).toContain("https://x/rapid-logo.png");
  expect(m.html).toContain('alt="Rapid Insulation"');
  expect(m.html.indexOf("Victorian Energy Upgrades program")).toBeGreaterThan(m.html.indexOf("Questions? Just reply"));
  expect(m.html.indexOf("Victorian Energy Upgrades program")).toBeLessThan(m.html.indexOf("VEU Accredited Person A003654"));
  for (const body of [m.subject, m.text, m.html]) expect(body).not.toMatch(/VEU discount|VEU rebate|\bHIV\b|\bfixes\b|lawyer/);
  // the v4 base is kept: rebate box, button, Next line, 30-day line
  expect(m.text).toContain("Your rebate: you save $600.");
  expect(m.text).toContain("Next: accept and pay $349.00 → electrical safety check (PIESA) → book your install day.");
  expect(m.text).toContain("Your quote is valid for 30 days, until 4 December 2026.");
});

test("Task 5: own customer, no logo (or a bad one) → one logo, no empty img, same rows", () => {
  for (const logo of [null, "http://x/logo.png", ""]) {
    const m = render({ ...ownInput, ownCustomer: { installerName: "Rapid Insulation", installerLogoUrl: logo } });
    expect(m.html).not.toMatch(/src=""/);
    expect(m.html.match(/<img /g)?.length).toBe(1);
    expect(rowTitles(m.text)).toEqual(["Insulation", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Rebate", "Your price"]);
  }
});

test("Task 5: separately agreed extras sit between Insulation and the fee under their own words", () => {
  const m = render({ ...ownInput, totalIncGst: 2398, subtotalIncGst: 2998, lines: [ownInput.lines[0]!, { code: "INSTALLER_REMOVAL", description: "Removal of existing insulation (40 m²)", lineTotalIncGst: 300 }, ownInput.lines[1]!, ownInput.lines[2]!] });
  expect(rowTitles(m.text)).toEqual(["Insulation", "Removal of existing insulation (40 m²)", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Rebate", "Your price"]);
  expect(m.text).toContain("Your price: $2,398.00");
});

test("Task 5 / I4: the ONE switch off (as shipped) → an own customer gets Part 3's v4 email unchanged (no rows, no VEU box, no logo)", () => {
  expect(OWN_CUSTOMER_COBRAND_APPROVED).toBe(false);
  expect(render(ownInput, { cobrandApproved: false })).toEqual(renderOwnerQuoteEmail(withoutOwn(ownInput)));
  expect(renderOwnerQuoteEmail(ownInput)).toEqual(renderOwnerQuoteEmail(withoutOwn(ownInput)));
});

test("Task 5: a malformed own-customer line set (no fee line) never guesses — falls back to Part 3's rows", () => {
  const m = render({ ...ownInput, lines: ownInput.lines.filter((l) => l.code !== "AP_FEE") });
  expect(m.text).toContain("YOUR QUOTE");
  expect(m.text).toContain("You pay: $2,098.00");
  expect(m.html).toContain("https://x/rapid-logo.png"); // the brand still applies; only the rows fell back
});

test("Task 5: Home Insulation Victoria leads are byte-identical to d89d335 (v3 and v4)", async () => {
  const hivBase = { ...base, subtotalIncGst: 3848, areaM2: 120, removalM2: 40, product: "Bradford Gold R5.0", installerName: "Reinsulate", installerCertified: true, validDays: 30 as const };
  const h = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const changes = [{ label: "Ceiling size", estimate: "100 m²", quote: "120 m²" }];
  const v3 = renderOwnerQuoteEmail({ ...hivBase, v4: false, changes });
  const v4 = renderOwnerQuoteEmail({ ...hivBase, v4: true, changes });
  expect(await h(`${v3.subject}\n${v3.html}\n${v3.text}`)).toBe("4172cc0c6650efc1c2e5a0e4ee26a338c12bb449d160befdb91a3c1737649b0b");
  expect(await h(`${v4.subject}\n${v4.html}\n${v4.text}`)).toBe("84b6860a9fb60798591620ce56b576cdc6aed6cc5f70aa9257c3ca29bf68d9a2");
  // the seam on with no ownCustomer changes nothing either
  expect(render({ ...hivBase, v4: true, changes })).toEqual(v4);
});

test("C1 (flags off, live today): an own customer's generic rows classify by code — the fee row is the fee, never 'insulation'", () => {
  const m = renderOwnerQuoteEmail(withoutOwn(ownInput) as OwnerQuoteEmailInput & { lines: typeof ownInput.lines });
  expect(m.text).toContain("Home Insulation Victoria fee (Home Insulation Victoria (VEU A003654): your quote, compliance checks, paperwork and rebate claim): $349.00");
  expect(m.text).toContain("Electrical safety check (PIESA) (By a licensed electrician, before any insulation goes in): $349.00");
  expect(m.text).not.toMatch(/Home Insulation Victoria fee \(VEU-approved/);
  expect(m.text).not.toMatch(/Home Insulation Victoria fee \(.*installed by/);
  // a line with no code still classifies by its wording (old quotes)
  const old = renderOwnerQuoteEmail({ ...withoutOwn(ownInput), lines: ownInput.lines.map(({ code: _c, ...l }) => l) });
  expect(old.text).toContain("Electrical safety check (PIESA) (By a licensed electrician, before any insulation goes in): $349.00");
});
