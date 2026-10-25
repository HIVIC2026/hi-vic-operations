// Decision 282 (Jo 25 Oct 2026): only the property address matters for duplicates. Pure rules only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { addressKey, normaliseStreetLine } from "../src/lib/address.core";
import { DUPLICATE_ADDRESS_EVENT, duplicateAddressFrom, duplicateAddressMessage, duplicateAddressSummary, isOpenJobStage, openJobAtAddress } from "../src/lib/duplicate-address.core";
import { parsePickupAudit, pickupDuplicates } from "../src/lib/mitti-pickup.core";
import { NEUTRAL_SAVE_ERROR, saveErrorMessage } from "../src/lib/add-job-flow.core";

describe("address normalisation (unit/number/street/suburb/postcode, case + abbreviation insensitive)", () => {
  test("street words and case", () => {
    expect(normaliseStreetLine("2A Chatfield St")).toBe("2a chatfield street");
    expect(normaliseStreetLine("2a CHATFIELD Street.")).toBe("2a chatfield street");
    expect(normaliseStreetLine("824 High Street Rd")).toBe("824 high street road");
    expect(normaliseStreetLine("5 Smith Ave")).toBe(normaliseStreetLine("5 Smith Avenue"));
    expect(normaliseStreetLine("9 Oak Crt")).toBe(normaliseStreetLine("9 Oak Ct"));
  });
  test("unit styles agree; a one-line address keeps only its street part", () => {
    for (const u of ["Unit 2, 5 Smith St", "unit 2 5 Smith Street", "U2 5 Smith St", "2/5 Smith St", "2 / 5 smith street", "Flat 2, 5 Smith St, Bundoora VIC 3083"]) expect(normaliseStreetLine(u)).toBe("2/5 smith street");
    expect(normaliseStreetLine("5 Smith St, Bundoora VIC 3083")).toBe("5 smith street");
    expect(normaliseStreetLine("")).toBe("");
    expect(normaliseStreetLine(null)).toBe("");
  });
  test("key = street + postcode; postcode read from the line when the field is empty; suburb only as a fallback", () => {
    expect(addressKey({ address_line: "5 Smith St", suburb: "Bundoora", postcode: "3083" })).toBe("5 smith street|3083");
    expect(addressKey({ address_line: "5 Smith Street, Bundoora VIC 3083", suburb: null, postcode: null })).toBe("5 smith street|3083");
    expect(addressKey({ address_line: "5 Smith St", suburb: "BUNDOORA VIC", postcode: null })).toBe("5 smith street|bundoora");
    expect(addressKey({ address_line: "5 Smith St", suburb: null, postcode: null })).toBeNull();
    expect(addressKey({ address_line: "", suburb: "Bundoora", postcode: "3083" })).toBeNull();
    expect(addressKey({ address_line: "5 Smith St", suburb: "Bundoora", postcode: "3083" })).not.toBe(addressKey({ address_line: "7 Smith St", suburb: "Bundoora", postcode: "3083" }));
    expect(addressKey({ address_line: "5 Smith St", suburb: "Bundoora", postcode: "3083" })).not.toBe(addressKey({ address_line: "1/5 Smith St", suburb: "Bundoora", postcode: "3083" }));
  });
});

const job = (o: Partial<{ id: string; job_number: string; stage: string; source: string | null; deleted_at: string | null; created_at: string; address_line: string; suburb: string; postcode: string }>) => ({
  id: "j1", job_number: "HV-1001", stage: "new_enquiry", source: "base44", deleted_at: null, created_at: "2026-10-01", address_line: "5 Smith St", suburb: "Bundoora", postcode: "3083", ...o,
});
const req = { address_line: "Unit 1, 5 Smith Street", suburb: "Bundoora", postcode: "3083", source: "installer_onsite" };

describe("the one duplicate rule: an OPEN job at the same address", () => {
  test("open stages count, cancelled/complete do not", () => {
    expect(isOpenJobStage("new_enquiry")).toBe(true); expect(isOpenJobStage("installation_booked")).toBe(true);
    expect(isOpenJobStage("cancelled")).toBe(false); expect(isOpenJobStage("complete")).toBe(false); expect(isOpenJobStage(null)).toBe(false);
  });
  test("same address open → that job (oldest first); closed or deleted → none; different address → none", () => {
    const open = job({ address_line: "1/5 Smith St" });
    expect(openJobAtAddress(req, [open])?.id).toBe("j1");
    expect(openJobAtAddress(req, [job({ address_line: "1/5 Smith St", stage: "complete" })])).toBeNull();
    expect(openJobAtAddress(req, [job({ address_line: "1/5 Smith St", stage: "cancelled" })])).toBeNull();
    expect(openJobAtAddress(req, [job({ address_line: "1/5 Smith St", deleted_at: "2026-10-02" })])).toBeNull();
    expect(openJobAtAddress(req, [job({ address_line: "5 Smith St" })])).toBeNull(); // the house, not unit 1
    expect(openJobAtAddress(req, [job({ id: "newer", address_line: "1/5 Smith St", created_at: "2026-10-09" }), job({ id: "older", address_line: "1/5 Smith St", created_at: "2026-10-03" })])?.id).toBe("older");
  });
  test("email and phone play no part", () => {
    // Nothing about owners is even an input to the rule.
    expect(Object.keys(req)).toEqual(["address_line", "suburb", "postcode", "source"]);
    const src = readFileSync("src/lib/duplicate-address.core.ts", "utf8");
    const rule = src.slice(src.indexOf("export type AddressJobCandidate"), src.indexOf("export const duplicateAddressMessage")); // the matching rule itself
    expect(rule).not.toMatch(/email|phone/i);
  });
  test("practice jobs and real jobs never match each other", () => {
    expect(openJobAtAddress({ ...req, source: "qa_test" }, [job({ address_line: "1/5 Smith St" })])).toBeNull();
    expect(openJobAtAddress({ ...req, source: "qa_test" }, [job({ address_line: "1/5 Smith St", source: "qa_test" })])?.id).toBe("j1");
    expect(openJobAtAddress({ ...req, source: "installer_onsite" }, [job({ address_line: "1/5 Smith St", source: "qa_test" })])).toBeNull();
  });
  test("wording: the installer sees the job number only; the office flag says where it came from", () => {
    expect(duplicateAddressMessage("HV-3201")).toBe("This address already has an open job (HV-3201) — the office has been told. No new job was added; your details are kept.");
    expect(duplicateAddressSummary("add_a_job", "TEST Installer")).toBe("Another request for this address came in from an installer's Add a job (TEST Installer) — linked here, no new job made; office to check");
    expect(duplicateAddressSummary("website", null)).toContain("from the website —");
    expect(duplicateAddressFrom("base44", "hivic_sourced")).toBe("website");
    expect(duplicateAddressFrom("installer_portal", "installer_sourced")).toBe("installer_intake");
    expect(duplicateAddressFrom("email", "hivic_sourced")).toBe("email");
    expect(duplicateAddressFrom("portal", "hivic_sourced")).toBe("office_intake");
    expect(DUPLICATE_ADDRESS_EVENT).toBe("duplicate_address_linked");
  });
});

describe("Add a job error wording after decision 282", () => {
  test("the address message passes through as is; raw unique-key text stays neutral; no email refusal exists", () => {
    expect(saveErrorMessage(duplicateAddressMessage("HV-3201"))).toBe(duplicateAddressMessage("HV-3201"));
    expect(saveErrorMessage('duplicate key value violates unique constraint "owners_email_uq"')).toBe(NEUTRAL_SAVE_ERROR);
    for (const f of ["src/lib/installer-owner.server.ts", "src/lib/add-job-flow.core.ts", "src/lib/onsite-ready-check.server.ts", "src/lib/bulk-import.server.ts", "src/lib/enquiry.server.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/isn't yours|possible_duplicate_owner/);
    }
  });
});

describe("Mitti pickup uses the same address rule", () => {
  const audit = () => ({ id: "a1", template_id: "t", owner_user_id: "u", modified_at: "2026-10-23", items: [
    { id: "i1", label: "Site address", type: "text", value: "2A Chatfield Street, Kingsville, Victoria, 3012" },
    { id: "i2", label: "Homeowner name", type: "text", value: "Courtney Daniels" },
  ] });
  test("a cancelled/complete job at the same address is no longer a duplicate; an open one is", () => {
    const p = parsePickupAudit(audit() as never);
    if (!p) return; // parsing shape covered in mitti-pickup.test.ts
    const jobs = [
      { id: "j1", job_number: "HV-2303", stage: "complete", owner: "Someone Else", addressLine: "2a Chatfield St", suburb: "Kingsville" },
      { id: "j2", job_number: "HV-2304", stage: "cancelled", owner: "Someone Else", addressLine: "2A CHATFIELD ST", suburb: "Kingsville" },
      { id: "j3", job_number: "HV-2305", stage: "ready_check_scheduled", owner: "Someone Else", addressLine: "2A Chatfield Street", suburb: "Kingsville" },
    ];
    expect(pickupDuplicates(p, jobs).map((d) => d.jobNumber)).toEqual(["HV-2305"]);
  });
});
