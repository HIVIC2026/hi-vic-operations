import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ourLeadUsualRecId } from "../src/lib/our-lead-piesa-electrician.core";

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
