// Test Centre: create clearly-marked fake trade accounts (3 installers + 3 electricians) with
// different agreed rate cards, so staff can run example jobs end to end. Admin-only; every record
// is prefixed "TEST" and uses a non-routable test email domain. Idempotent: re-running skips
// accounts that already exist.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WorkflowError } from "./workflow.server";

type RateItem = { code: string; description: string; category: string; unit: string; display_unit?: string; r_value?: number | null; sort: number; unit_price_ex_gst: number };

type Spec = {
  key: string;
  role: "installer" | "electrician";
  businessType: "eec_installer" | "rec";
  cardKind: "installer" | "electrical";
  name: string;
  email: string;
  phone: string;
  items: RateItem[];
};

const SPECS: Spec[] = [
  {
    key: "alpha", role: "installer", businessType: "eec_installer", cardKind: "installer",
    name: "TEST Alpha Insulation", email: "qa.installer.alpha@hivic-test.example", phone: "0400000101",
    items: [
      { code: "R5_BATTS", description: "R5.0 ceiling batts supply & install", category: "product", unit: "m2", r_value: 5, sort: 1, unit_price_ex_gst: 11.5 },
      { code: "BATTS_REMOVAL", description: "Batts removal and disposal", category: "removal", unit: "m2", sort: 2, unit_price_ex_gst: 4.0 },
      { code: "LOOSE_FILL_REMOVAL", description: "Loose-fill removal and disposal", category: "removal", unit: "m2", sort: 3, unit_price_ex_gst: 6.5 },
      { code: "TILE_ROOF_ACCESS", description: "Tile roof access (lift & relay tiles)", category: "access", unit: "flat", sort: 10, unit_price_ex_gst: 250 },
      { code: "CALL_OUT_MINIMUM", description: "Minimum charge / call-out", category: "travel", unit: "flat", sort: 13, unit_price_ex_gst: 150 },
    ],
  },
  {
    key: "bravo", role: "installer", businessType: "eec_installer", cardKind: "installer",
    name: "TEST Bravo Insulation", email: "qa.installer.bravo@hivic-test.example", phone: "0400000102",
    items: [
      { code: "R5_BATTS", description: "R5.0 ceiling batts supply & install", category: "product", unit: "m2", r_value: 5, sort: 1, unit_price_ex_gst: 12.9 },
      { code: "BATTS_REMOVAL", description: "Batts removal and disposal", category: "removal", unit: "m2", sort: 2, unit_price_ex_gst: 4.5 },
      { code: "LOOSE_FILL_REMOVAL", description: "Loose-fill removal and disposal", category: "removal", unit: "m2", sort: 3, unit_price_ex_gst: 7.0 },
      { code: "DIFFICULT_ACCESS", description: "Difficult / restricted ceiling access", category: "access", unit: "flat", sort: 12, unit_price_ex_gst: 300 },
    ],
  },
  {
    key: "charlie", role: "installer", businessType: "eec_installer", cardKind: "installer",
    name: "TEST Charlie Insulation", email: "qa.installer.charlie@hivic-test.example", phone: "0400000103",
    items: [
      { code: "R5_BATTS", description: "R5.0 ceiling batts supply & install", category: "product", unit: "m2", r_value: 5, sort: 1, unit_price_ex_gst: 10.75 },
      { code: "BATTS_REMOVAL", description: "Batts removal and disposal", category: "removal", unit: "m2", sort: 2, unit_price_ex_gst: 3.8 },
      { code: "LOOSE_FILL_REMOVAL", description: "Loose-fill removal and disposal", category: "removal", unit: "m2", sort: 3, unit_price_ex_gst: 6.0 },
      { code: "METAL_ROOF_ACCESS", description: "Metal sheet roof access", category: "access", unit: "flat", sort: 11, unit_price_ex_gst: 220 },
    ],
  },
  {
    key: "delta", role: "electrician", businessType: "rec", cardKind: "electrical",
    name: "TEST Delta Electrical", email: "qa.rec.delta@hivic-test.example", phone: "0400000201",
    items: [
      { code: "PIESA", description: "Pre-insulation electrical safety assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
      { code: "INSTALL_ATTENDANCE", description: "Installation-day electrical attendance", category: "electrical", unit: "flat", sort: 2, unit_price_ex_gst: 180 },
      { code: "DOWNLIGHT_UPGRADE", description: "Downlight upgrade to IC-4 LED", category: "electrical", unit: "each", display_unit: "light", sort: 10, unit_price_ex_gst: 45 },
      { code: "SWITCHBOARD_UPGRADE", description: "Switchboard upgrade", category: "electrical", unit: "each", display_unit: "switchboard", sort: 11, unit_price_ex_gst: 1200 },
      { code: "RCD_INSTALL", description: "RCD installation", category: "electrical", unit: "each", display_unit: "RCD", sort: 12, unit_price_ex_gst: 220 },
      { code: "TPS_CABLE_REPLACEMENT", description: "TPS cable replacement", category: "electrical", unit: "each", display_unit: "metre", sort: 13, unit_price_ex_gst: 18 },
      { code: "EXHAUST_CLEARANCE", description: "Exhaust fan clearance guard", category: "electrical", unit: "each", display_unit: "guard", sort: 14, unit_price_ex_gst: 60 },
      { code: "COES", description: "Certificate of Electrical Safety", category: "electrical", unit: "flat", sort: 20, unit_price_ex_gst: 66 },
    ],
  },
  {
    key: "echo", role: "electrician", businessType: "rec", cardKind: "electrical",
    name: "TEST Echo Electrical", email: "qa.rec.echo@hivic-test.example", phone: "0400000202",
    items: [
      { code: "PIESA", description: "Pre-insulation electrical safety assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
      { code: "INSTALL_ATTENDANCE", description: "Installation-day electrical attendance", category: "electrical", unit: "flat", sort: 2, unit_price_ex_gst: 200 },
      { code: "DOWNLIGHT_UPGRADE", description: "Downlight upgrade to IC-4 LED", category: "electrical", unit: "each", display_unit: "light", sort: 10, unit_price_ex_gst: 52 },
      { code: "SWITCHBOARD_UPGRADE", description: "Switchboard upgrade", category: "electrical", unit: "each", display_unit: "switchboard", sort: 11, unit_price_ex_gst: 1350 },
      { code: "RCD_INSTALL", description: "RCD installation", category: "electrical", unit: "each", display_unit: "RCD", sort: 12, unit_price_ex_gst: 240 },
      { code: "TPS_CABLE_REPLACEMENT", description: "TPS cable replacement", category: "electrical", unit: "each", display_unit: "metre", sort: 13, unit_price_ex_gst: 22 },
      { code: "EXHAUST_CLEARANCE", description: "Exhaust fan clearance guard", category: "electrical", unit: "each", display_unit: "guard", sort: 14, unit_price_ex_gst: 75 },
      { code: "COES", description: "Certificate of Electrical Safety", category: "electrical", unit: "flat", sort: 20, unit_price_ex_gst: 66 },
    ],
  },
  {
    key: "foxtrot", role: "electrician", businessType: "rec", cardKind: "electrical",
    name: "TEST Foxtrot Electrical", email: "qa.rec.foxtrot@hivic-test.example", phone: "0400000203",
    items: [
      { code: "PIESA", description: "Pre-insulation electrical safety assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
      { code: "INSTALL_ATTENDANCE", description: "Installation-day electrical attendance", category: "electrical", unit: "flat", sort: 2, unit_price_ex_gst: 165 },
      { code: "DOWNLIGHT_UPGRADE", description: "Downlight upgrade to IC-4 LED", category: "electrical", unit: "each", display_unit: "light", sort: 10, unit_price_ex_gst: 40 },
      { code: "SWITCHBOARD_UPGRADE", description: "Switchboard upgrade", category: "electrical", unit: "each", display_unit: "switchboard", sort: 11, unit_price_ex_gst: 1100 },
      { code: "RCD_INSTALL", description: "RCD installation", category: "electrical", unit: "each", display_unit: "RCD", sort: 12, unit_price_ex_gst: 200 },
      { code: "TPS_CABLE_REPLACEMENT", description: "TPS cable replacement", category: "electrical", unit: "each", display_unit: "metre", sort: 13, unit_price_ex_gst: 15 },
      { code: "EXHAUST_CLEARANCE", description: "Exhaust fan clearance guard", category: "electrical", unit: "each", display_unit: "guard", sort: 14, unit_price_ex_gst: 55 },
      { code: "COES", description: "Certificate of Electrical Safety", category: "electrical", unit: "flat", sort: 20, unit_price_ex_gst: 66 },
    ],
  },
];

export const createTestTradeAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new WorkflowError("Admin only.");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const results: { name: string; role: string; status: "created" | "already existed" }[] = [];
    for (const spec of SPECS) {
      const { data: existingBiz } = await admin.from("businesses").select("id").eq("name", spec.name).maybeSingle();
      if (existingBiz) { results.push({ name: spec.name, role: spec.role, status: "already existed" }); continue; }
      let uid: string;
      const { data: existingProfile } = await admin.from("profiles").select("id").eq("email", spec.email).maybeSingle();
      if (existingProfile) {
        uid = existingProfile.id; // recover a half-created account from an earlier run
      } else {
        const { data: user, error: userError } = await admin.auth.admin.createUser({
          email: spec.email,
          password: crypto.randomUUID() + "Qa!",
          email_confirm: true,
          user_metadata: { full_name: spec.name, qa_test: true },
        });
        if (userError || !user.user) throw new WorkflowError(`Could not create ${spec.name}: ${userError?.message ?? "unknown error"}`);
        uid = user.user.id;
      }
      const now = new Date().toISOString();
      const { data: business, error: bizError } = await admin.from("businesses").insert({
        name: spec.name, legal_name: spec.name, trading_name: spec.name, business_type: spec.businessType,
        email: spec.email, phone: spec.phone, commercial_route: "hivic_full_invoice", default_comms_owner: "hivic",
        onboarding_status: "approved", is_active: true, approved_by: context.userId, approved_at: now,
        gst_registered: true, onboarding_notes: "Test account created from the Test Centre. Not a real partner.",
      }).select("id").single();
      if (bizError || !business) throw new WorkflowError(`Could not create business for ${spec.name}: ${bizError?.message}`);
      const { error: profileError } = await admin.from("profiles").upsert({ id: uid, full_name: spec.name, email: spec.email, phone: spec.phone, business_id: business.id });
      if (profileError) throw new WorkflowError(`Could not create profile for ${spec.name}: ${profileError.message}`);
      const { error: roleError } = await admin.from("user_roles").insert({ user_id: uid, role: spec.role });
      if (roleError) throw new WorkflowError(`Could not assign role for ${spec.name}: ${roleError.message}`);
      const { error: memberError } = await admin.from("business_members").insert({ business_id: business.id, user_id: uid, member_role: "owner", active: true, added_by: context.userId });
      if (memberError) throw new WorkflowError(`Could not link ${spec.name}: ${memberError.message}`);
      const { data: card, error: cardError } = await admin.from("rate_cards").insert({ kind: spec.cardKind, business_id: business.id, name: `${spec.name} agreed rates`, version: 1, is_active: true }).select("id").single();
      if (cardError || !card) throw new WorkflowError(`Could not create rate card for ${spec.name}: ${cardError?.message}`);
      const { error: itemError } = await admin.from("rate_card_items").insert(spec.items.map((item) => ({ ...item, rate_card_id: card.id })));
      if (itemError) throw new WorkflowError(`Could not create rates for ${spec.name}: ${itemError.message}`);
      results.push({ name: spec.name, role: spec.role, status: "created" });
    }
    return { results };
  });
