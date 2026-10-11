import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { INSTALLER_AGREEMENT_SECTIONS } from "../src/lib/installer-agreement.text";
import { INSTALLER_AGREEMENT_VERSION, agreementText } from "../src/lib/installer-onboarding.core";
import { jobMargin } from "../src/lib/profit.core";

const NO = "Home Insulation Victoria does not charge installers or electricians a lead fee.";
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const active = walk("src").filter((p) => /\.(ts|tsx)$/.test(p) && !p.includes("integrations/supabase"));

describe("C03 no lead fee", () => {
  test("no active code charges, deducts, displays or edits a lead fee", () => {
    const bad: string[] = [];
    for (const p of active) {
      const t = readFileSync(p, "utf8");
      for (const re of [/\$220/, /partner_lead_fee/, /referralFee/, /leadFeeEarned/, /LEAD_FEE/, /lead fee (is|will be) (deducted|charged)/i, /deduct\w* .{0,40}lead fee/i]) if (re.test(t)) bad.push(`${p}: ${re}`);
    }
    expect(bad).toEqual([]);
  });
  test("every remaining lead-fee mention says there is no lead fee", () => {
    for (const p of active) for (const line of readFileSync(p, "utf8").split("\n")) if (/lead fee/i.test(line)) expect(/no lead fee|does not charge installers or electricians a lead fee|charge a lead fee\?/i.test(line)).toBe(true);
  });
  test("new installer agreement version contains the no-fee position and no fee clause", () => {
    expect(INSTALLER_AGREEMENT_VERSION).toBe("HI-VIC-A48-INST-1.19-2026-10-09");
    const all = INSTALLER_AGREEMENT_SECTIONS.flatMap((s) => s.paras).join("\n");
    expect(all).toContain(NO);
    expect(all).not.toMatch(/\$220|deducted from the Installer's payout/);
    expect(agreementText({} as never)).toContain(`Version: ${INSTALLER_AGREEMENT_VERSION}`);
  });
  test("office fee editor and fee service are gone", () => {
    expect(existsSync("src/lib/partner-fees.functions.ts")).toBe(false);
    expect(readFileSync("src/routes/_authenticated/admin.partners.tsx", "utf8")).not.toMatch(/LeadFeeCard|updatePartnerLeadFee/);
  });
  test("payout/margin is identical for our leads and installer-owned customers", () => {
    const b = { installerCostExGst: 2000, installerMarginExGst: 200, apFeeExGst: 317, electricalCostExGst: 0, electricalChargeExGst: 0, installerSourced: true, veecDiscountIncGst: 700, piesaRecCostExGst: null, veecLodgementFeeExGst: null };
    expect(jobMargin(b, 90)).toEqual(jobMargin({ ...b, installerSourced: false }, 90));
  });
  test("historic migration and settings column are kept (history preserved)", () => {
    expect(existsSync("drizzle/migrations/0068_partner_lead_fee_setting.sql")).toBe(true);
  });
});
