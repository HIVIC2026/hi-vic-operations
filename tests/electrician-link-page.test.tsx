// New job flow, Part 6, Task 2: the /e/$token page. Source-reading for the route, and the step block rendered to markup.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ElectricianLinkBody } from "../src/components/trade/ElectricianLinkBody";
import { electricianStep, type ElectricianLinkFacts } from "../src/lib/electrician-link.core";

const route = readFileSync("src/routes/e.$token.tsx", "utf8");
const fns = readFileSync("src/lib/electrician-link.functions.ts", "utf8");

const facts = (over: Partial<ElectricianLinkFacts> = {}): ElectricianLinkFacts => ({
  whoBooks: "electrician", handedBack: false, certificateIn: false, now: new Date("2026-11-03T02:00:00Z"),
  piesa: { start: "2026-11-06T23:00:00Z", formUrl: "https://app.au.safetyculture.com/inspection/a3", outcome: null, upgradesSameDay: false },
  upgrades: { start: null, formUrl: null, formDone: false }, ...over,
});
const body = (over: Partial<Parameters<typeof ElectricianLinkBody>[0]["d"]> = {}) => renderToStaticMarkup(<ElectricianLinkBody d={{
  business: "Spark Co", firstName: "Sam", jobNumber: "HV-5001", owner: { name: "Helen Owner", phone: "0411 111 111" }, address: "12 Smith St, Kew VIC 3101",
  view: electricianStep(facts()), buttonUrl: "https://app.au.safetyculture.com/inspection/a3", ...over }} />);

test("route /e/$token: no sign-in, client only, noindex, no referrer, the website look", () => {
  expect(route).toContain('createFileRoute("/e/$token")');
  expect(route).toContain("ssr: false");
  expect(route).toContain('{ name: "robots", content: "noindex, nofollow" }');
  expect(route).toContain('{ name: "referrer", content: "no-referrer" }');
  expect(route).toContain("TradePublicShell");
  expect(route).not.toMatch(/beforeLoad|requireAuth|useAccess/);
  expect(route).not.toContain("<TradeShell");
  expect(route).toContain("getElectricianLinkView");
});
test("a bad link shows a plain card, not a crash", () => {
  expect(route).toContain("data-electrician-link-invalid");
  expect(route).toContain("readableError(q.error");
});
test("the server function is a literal chain with no auth middleware and only the token as input", () => {
  expect(fns).toContain('createServerFn({ method: "POST" })');
  expect(fns).toContain(".inputValidator(");
  expect(fns).toContain(".handler(");
  expect(fns).not.toContain(".middleware(");
  expect(fns).not.toContain("@tanstack/react-start/server");
  expect(fns).toMatch(/z\.object\(\{ token: z\.string\(\)\.max\(100\) \}\)/);
  expect(fns).not.toMatch(/jobId|workerId|businessId/);
});
test("shows '{business} · {first}', the step title, owner name, a tel: link on the phone and the address", () => {
  const h = body();
  expect(h).toContain("Spark Co · Sam");
  expect(h).toContain("Safety check day");
  expect(h).toContain("Helen Owner");
  expect(h).toContain('href="tel:0411111111"');
  expect(h).toContain("12 Smith St, Kew VIC 3101");
});
test("exactly ONE green button, to the Mitti form", () => {
  const h = body();
  expect(h.match(/data-electrician-button/g)).toHaveLength(1);
  expect(h).toContain('href="https://app.au.safetyculture.com/inspection/a3"');
  expect(h).toContain("Open safety check form");
  expect(h).toContain("bg-action");
});
test("no owner block when the server sent no contact; no button when the step has no form", () => {
  const h = body({ owner: null, address: null, view: electricianStep(facts({ whoBooks: "office", piesa: { start: null, formUrl: null, outcome: null, upgradesSameDay: false } })), buttonUrl: null });
  expect(h).not.toContain("data-electrician-job");
  expect(h).not.toContain("data-electrician-button");
  expect(h).toContain("The office is booking the safety check");
});
test("no menu, no prices, no messages, no rate items", () => {
  const h = body();
  expect(h).not.toMatch(/<nav/);
  expect(h).not.toMatch(/\$\d|price|Messages|rate|Money|My business|HIV/i);
  const src = readFileSync("src/components/trade/ElectricianLinkBody.tsx", "utf8");
  expect(src).not.toMatch(/<TradeShell|TradeTabBar|useAccess/);
});

// Task 5: the upload step.
test("the upload step shows a file picker for a photo or PDF and the one green button, no link button", () => {
  const d = { business: "Spark Co", firstName: "Sam", jobNumber: "HV-5001", owner: null, address: null, buttonUrl: null,
    view: electricianStep(facts({ piesa: { start: "2026-11-06T23:00:00Z", formUrl: null, outcome: "upgrades", upgradesSameDay: true } })) };
  const h = renderToStaticMarkup(<ElectricianLinkBody d={d} onUpload={async () => ({ ok: true })} />);
  expect(h).toContain("Upload the Certificate of Electrical Safety");
  expect(h).toContain("data-electrician-upload");
  expect(h).toContain('type="file"');
  expect(h).toContain('accept="application/pdf,image/*,.pdf,.heic,.heif"');
  expect(h).toContain("Upload the certificate");
  expect(h.match(/data-electrician-upload-button/g)).toHaveLength(1);
});
test("other steps show no file picker", () => {
  expect(body()).not.toContain('type="file"');
});
test("the route sends the file through the token-only upload function and reloads the step", () => {
  expect(route).toContain("uploadCoesByLink");
  expect(route).toContain("onUpload");
  expect(fns).toContain("export const uploadCoesByLink");
  expect(fns).toMatch(/uploadCoesByLink[\s\S]*token: z\.string\(\)\.max\(100\)/);
  // The body (up to ~20 MB of text) is decoded only after the token and link checks passed (a bad link costs nothing).
  expect(fns).toMatch(/uploadCoesByLink[\s\S]*bytes: \(\) => new Uint8Array\(Buffer\.from\(data\.data, "base64"\)\)/);
  expect(fns).not.toContain(".middleware(");
});

// Task 6: "Can't do this one".
test("'Can't do this one' is offered on a live step, as a plain control (never the one green button), with a reason box", () => {
  const h = renderToStaticMarkup(<ElectricianLinkBody d={{ business: "Spark Co", firstName: "Sam", jobNumber: "HV-5001", owner: null, address: null, buttonUrl: "https://app.au.safetyculture.com/inspection/a3", view: electricianStep(facts()) }} onCantDo={async () => ({ ok: true })} />);
  expect(h).toContain("data-electrician-cant-do");
  expect(h).toContain("Can&#x27;t do this one");
  expect(h.match(/bg-action/g)).toHaveLength(1);
  // Tapping it opens the reason box (closed to start, so a stray tap hands nothing back); the server requires the reason too.
  const src = readFileSync("src/components/trade/ElectricianLinkBody.tsx", "utf8");
  expect(src).toContain("data-electrician-cant-do-reason");
  expect(src).toContain("electricianCantDoReasonOk(reason)");
  expect(src).not.toMatch(/data-electrician-cant-do-button[^\n]*bg-action/);
});
test("not offered once the job is done or handed back, or when the route gives no handler", () => {
  for (const f of [facts({ piesa: { start: "2026-11-06T23:00:00Z", formUrl: null, outcome: "pass", upgradesSameDay: false } }), facts({ handedBack: true })]) {
    const h = renderToStaticMarkup(<ElectricianLinkBody d={{ business: "Spark Co", firstName: "Sam", jobNumber: "HV-5001", owner: null, address: null, buttonUrl: null, view: electricianStep(f) }} onCantDo={async () => ({ ok: true })} />);
    expect(h).not.toContain("data-electrician-cant-do");
  }
  expect(body()).not.toContain("data-electrician-cant-do");
});

// Fix round 2, R1: changing a booked time from the page.
test("a booked day with canChange shows a DRAFT 'Change the time' ghost control (never the green button) that opens the day-and-time form; without canChange nothing", () => {
  const v = electricianStep(facts()); // piesa_day, whoBooks electrician → canChange
  expect(v.canChange).toBe(true);
  const h = renderToStaticMarkup(<ElectricianLinkBody d={{ business: "Spark Co", firstName: "Sam", jobNumber: "HV-5001", owner: null, address: null, buttonUrl: "https://app.au.safetyculture.com/inspection/a3", view: v }} onBook={async () => ({ ok: true })} />);
  expect(h).toContain("data-electrician-change-time");
  expect(h).toContain("Change the time");
  expect(h.match(/bg-action/g)).toHaveLength(1); // the Mitti form button stays the one green button
  expect(h).not.toContain("data-electrician-book"); // the form opens on tap
  const src = readFileSync("src/components/trade/ElectricianLinkBody.tsx", "utf8");
  expect(src).toContain("<BookForm label={ELECTRICIAN_CHANGE_TIME_SAVE}");
  const off = renderToStaticMarkup(<ElectricianLinkBody d={{ business: "Spark Co", firstName: "Sam", jobNumber: "HV-5001", owner: null, address: null, buttonUrl: null, view: electricianStep(facts({ whoBooks: "office" })) }} onBook={async () => ({ ok: true })} />);
  expect(off).not.toContain("data-electrician-change-time");
});
test("the route gives the Book handler to a booked day too and maps the step to the visit kind", () => {
  // Join 4 Nov 2026: `d` is the worker-link data of the page's one read (an own-job link renders its own body first).
  expect(route).toContain('d.view.step === "set_upgrades_day" || d.view.step === "upgrades_day" ? "rectification" : "assessment"');
  expect(route).toContain("d.view.canBook || d.view.canChange");
});
