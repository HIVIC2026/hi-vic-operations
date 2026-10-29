import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ourLeadPreferredId, ourLeadUsualRecId } from "../src/lib/our-lead-piesa-electrician.core";

test("matches by licence then name; none → null", () => {
  const c = [{ business_id: "v", name: "Viking Electrical Services Aus PTY LTD", rec_number: "38603" }];
  expect(ourLeadUsualRecId({ name: "Will Casdorff", licence: "38603" }, c)).toBe("v");
  expect(ourLeadUsualRecId({ name: "Viking Electrical Services Aus", licence: "ZZZ" }, c)).toBe("v");
  expect(ourLeadUsualRecId(null, c)).toBeNull();
  expect(ourLeadUsualRecId({ name: "Tudor", licence: "1" }, c)).toBeNull();
});
test("server passes our_lead rule and Ready Check installer for HIV leads", () => {
  const src = readFileSync("src/lib/auto-offer.server.ts", "utf8");
  expect(src).toContain("quotedInstaller");
  expect(src).toContain('preferredRule: job.channel === "installer_sourced" ? "installer_job" : "our_lead"');
});
test("helper matches a candidate shaped like the real server input", () => {
  const c = [{ business_id: "v", name: "Viking Electrical Services Aus PTY LTD", trading_name: null, rec_number: "38603", worker_licences: [] }];
  expect(ourLeadUsualRecId({ name: "Will Casdorff", licence: "38603" }, c)).toBe("v");
});
const approved = [
  { business_id: "v", name: "Viking Electrical Services Aus PTY LTD", trading_name: null, rec_number: "38603", worker_licences: [] as string[] },
  { business_id: "w", name: "Wiring Co", trading_name: null, rec_number: "111", worker_licences: ["A81638"] },
];
test("ourLeadPreferredId: person name + REC licence, worker licence, not offerable, null", () => {
  expect(ourLeadPreferredId({ name: "Will Casdorff", licence: "38603" }, approved, ["v", "w"])).toBe("v");
  expect(ourLeadPreferredId({ name: "Someone", licence: "A81638" }, approved, ["v", "w"])).toBe("w");
  expect(ourLeadPreferredId({ name: "Will Casdorff", licence: "38603" }, approved, ["w"])).toBeNull();
  expect(ourLeadPreferredId(null, approved, ["v", "w"])).toBeNull();
});
