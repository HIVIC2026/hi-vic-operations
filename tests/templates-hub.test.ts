// Decision 379 (Jo 25 Oct 2026): the Templates page lists ONLY current templates, each rendered from the live builder with
// TEST sample data, grouped by who gets it and in job order. These tests keep it current: every entry must come from a
// live code path, and every live email builder / approved text type must be on the page.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { OFFICE_HEADINGS, sectionFor } from "../src/lib/office-nav";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import {
  NOT_LISTED_BUILDERS, STEP_ORDER, TEMPLATE_ENTRIES, TEMPLATE_SECTIONS, entriesFor, parseTemplateSearch, selectTemplate, templateStatus,
  type TemplateEntry,
} from "../src/lib/template-hub.core";

const read = (p: string) => readFileSync(p, "utf8");
const exportsName = (file: string, name: string) => new RegExp(`export (?:async )?(?:function|const|let) ${name}\\b|export \\{[^}]*\\b${name}\\b`).test(read(file));

describe("Templates navigation", () => {
  test("Templates sits under More (decision 218), not in the top bar", () => {
    expect(OFFICE_HEADINGS.map((h) => h.key)).toEqual(["needs", "enquiries", "jobs", "partners", "money"]);
    expect(sectionFor("/admin/templates", { cat: "mitti" })).toBe("more");
    expect(OFFICE_HEADINGS.filter((h) => h.label === "Templates").length).toBe(0);
  });
  test("sections are who-gets-it (Jo's choice) with drafts kept apart; old ?cat= bookmarks fall back to Owner", () => {
    expect(TEMPLATE_SECTIONS.map((s) => s.key)).toEqual(["owner", "installer", "electrician", "office", "mitti", "compliance", "invoices", "waiting"]);
    for (const s of TEMPLATE_SECTIONS.filter((x) => x.key !== "waiting")) expect(entriesFor(s.key).length).toBeGreaterThan(0); // "waiting" is empty since decision 406 (its tab hides when empty)
    expect(parseTemplateSearch({ cat: "email" })).toEqual({ cat: "owner" });
    expect(parseTemplateSearch({ cat: "mitti", t: "mitti:A5" })).toEqual({ cat: "mitti", t: "mitti:A5" });
    expect(selectTemplate("mitti", "owner:O18").section).toBe("mitti");
  });
  test("unique ids; each section in job order (enquiry → Ready Check → quote → safety check → fixes → install → rebate → paid)", () => {
    expect(new Set(TEMPLATE_ENTRIES.map((e) => e.id)).size).toBe(TEMPLATE_ENTRIES.length);
    for (const s of TEMPLATE_SECTIONS) {
      const steps = entriesFor(s.key).map((e) => STEP_ORDER.indexOf(e.step));
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
    }
    expect(entriesFor("mitti").map((e) => e.code)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
  });
  test("drafts waiting for Jo sit only in their own section; everything else is approved", () => {
    for (const e of TEMPLATE_ENTRIES) expect({ id: e.id, waiting: e.section === "waiting" }).toEqual({ id: e.id, waiting: e.approval === "waiting" });
    for (const e of entriesFor("waiting")) expect(templateStatus(e, null).label).toBe("Off — waiting for Jo's approval");
  });
  test("decision 384: the four decision 376 messages are listed under who gets them, approved, with their designs filed there", () => {
    const where: Record<string, [string, string | null]> = {
      "owner:O74": ["owner", "docs/templates/mjml/owner_O74.mjml"], "owner:O74b": ["owner", "docs/templates/mjml/owner_O74b.mjml"],
      "owner:sms-visit_new_times": ["owner", null], "owner:O75": ["owner", "docs/templates/mjml/owner_O75.mjml"],
      "electrician:E14": ["electrician", "docs/templates/mjml/electrician_E14.mjml"], "electrician:sms-piesa_times_reminder": ["electrician", null],
      "installer:I71": ["installer", "docs/templates/mjml/installer_I71.mjml"], "installer:sms-installer_planning_notice": ["installer", null],
    };
    for (const [id, [section, design]] of Object.entries(where)) {
      const e = TEMPLATE_ENTRIES.find((x) => x.id === id);
      expect({ id, section: e?.section, approval: e?.approval, design: e?.design ?? null, gate: e?.gate.kind }).toEqual({ id, section, approval: "approved", design, gate: design ? "email" : "text" });
      expect(e!.approvalNote).toContain("decision 384");
    }
    const waitingCodes = entriesFor("waiting").map((e) => e.code);
    for (const c of ["O74", "O74b", "O75", "E14", "I71"]) expect(waitingCodes).not.toContain(c);
    expect(entriesFor("waiting").some((e) => /visit_new_times|piesa_times_reminder|installer_planning_notice/.test(e.id))).toBe(false);
    // Approved is not live: emails wait for the customer messages switch, texts also for their own switch.
    const byId = (id: string) => TEMPLATE_ENTRIES.find((x) => x.id === id)!;
    expect(templateStatus(byId("owner:O75"), { customer_comms: false }).label).toBe("Waits for customer messages switch");
    expect(templateStatus(byId("owner:O75"), { customer_comms: true }).label).toBe("Live");
    for (const t of ["owner:sms-visit_new_times", "electrician:sms-piesa_times_reminder", "installer:sms-installer_planning_notice"]) {
      expect(templateStatus(byId(t), { customer_comms: true }).label).toBe("Waits for its text switch");
      const type = (byId(t).gate as { smsType: string }).smsType;
      expect(templateStatus(byId(t), { customer_comms: true, [`sms:${type}`]: true }).label).toBe("Live");
    }
  });
});

describe("every entry renders EXACTLY from the live code with TEST sample data", () => {
  test("each entry renders; emails are full documents with a subject; texts carry the brand line; nothing unfilled", () => {
    for (const e of TEMPLATE_ENTRIES) {
      const p = e.render();
      const all = JSON.stringify(p);
      expect({ id: e.id, bad: /undefined|NaN|\[object Object\]|\{first_name\}|\{address\}/.test(all) }).toEqual({ id: e.id, bad: false });
      if (p.kind === "email") {
        expect({ id: e.id, subject: p.subject.length > 0, doc: /^<!doctype html/i.test(p.html.trimStart()) }).toEqual({ id: e.id, subject: true, doc: true });
        expect(p.html).not.toContain("TEST — only sent to Jo"); // shown as real recipients see it
      }
      if (p.kind === "text") expect(p.body.startsWith("Home Insulation Victoria")).toBe(true);
      if (p.kind === "texts") for (const v of p.variants) expect({ id: e.id, v: v.label, ok: v.body.startsWith("Home Insulation Victoria") && v.body.length > 30 }).toEqual({ id: e.id, v: v.label, ok: true });
      if (p.kind === "questions") expect(p.groups.flatMap((g) => g.items).length).toBeGreaterThan(5);
    }
  });
  test("every entry names a live code path: the builder exports it and the sender uses it", () => {
    for (const e of TEMPLATE_ENTRIES) {
      const { builder, fn, sender } = e.source;
      expect({ id: e.id, builder: existsSync(builder), sender: existsSync(sender) }).toEqual({ id: e.id, builder: true, sender: true });
      expect({ id: e.id, fn, exported: exportsName(builder, fn) }).toEqual({ id: e.id, fn, exported: true });
      const s = read(sender);
      const mod = builder.replace(/^src\/lib\//, "").replace(/\.tsx?$/, "");
      const uses = s.includes(fn) || s.includes(`/${mod}"`) || (e.gate.kind === "text" && s.includes(`"${e.gate.smsType}"`));
      expect({ id: e.id, sender, uses }).toEqual({ id: e.id, sender, uses: true });
    }
  });
  test("design files and preview files exist where the page points (docs/templates by who gets it)", () => {
    for (const e of TEMPLATE_ENTRIES) {
      if (e.design) expect({ id: e.id, design: e.design, exists: existsSync(e.design) }).toEqual({ id: e.id, design: e.design, exists: true });
      const p = e.render();
      if (p.kind === "file") expect({ id: e.id, path: p.path, exists: existsSync(p.path) }).toEqual({ id: e.id, path: p.path, exists: true });
      if (p.kind === "files") for (const f of p.items) if (f.path && !f.path.startsWith("docs/product-warranties/")) expect({ id: e.id, path: f.path, exists: existsSync(f.path) }).toEqual({ id: e.id, path: f.path, exists: true });
    }
    for (const dir of ["owner", "installer", "electrician", "office", "mitti", "compliance", "invoices", "drafts"]) expect(existsSync(`docs/templates/${dir}`)).toBe(true);
    for (const old of ["approved", "samples"]) expect(existsSync(`docs/templates/${old}`)).toBe(false);
  });
  test("code-off entries name a real false switch in code", () => {
    for (const e of TEMPLATE_ENTRIES.filter((x) => x.gate.kind === "code_off")) {
      const flag = (e.gate as { flag: string }).flag;
      const hits = readdirSync("src/lib").filter((f) => /\.ts$/.test(f)).filter((f) => new RegExp(`export const ${flag}(: boolean)? = false`).test(read(`src/lib/${f}`)));
      expect({ id: e.id, flag, off: hits.length }).toEqual({ id: e.id, flag, off: 1 });
    }
  });
});

describe("nothing live is missing from the page", () => {
  const listedFns = new Set(TEMPLATE_ENTRIES.map((e) => e.source.fn));
  test("every approved text type is on the page", () => {
    const listed = new Set(TEMPLATE_ENTRIES.flatMap((e) => (e.gate.kind === "text" ? [e.gate.smsType] : [])));
    for (const [type, t] of Object.entries(SMS_MESSAGE_TYPES)) if (t.wordingApproved) expect({ type, listed: listed.has(type) }).toEqual({ type, listed: true });
    for (const type of listed) expect({ type, known: type in SMS_MESSAGE_TYPES }).toEqual({ type, known: true });
  });
  test("every email builder in src/lib is on the page or explicitly not listed (with a reason)", () => {
    // Helpers whose name ends in "Email" but that build no message.
    const NOT_BUILDERS = new Set(["normaliseEmail", "normaliseLoginEmail", "validBusinessEmail", "cleanOwnerEmail", "isHumanOwnerEmail", "guessJobsForEmail", "simpleEmail", "mjEmail"]);
    const found: string[] = [];
    for (const f of readdirSync("src/lib").filter((x) => /\.tsx?$/.test(x) && !/\.(server|functions)\.tsx?$/.test(x))) {
      for (const m of read(`src/lib/${f}`).matchAll(/export (?:async )?(?:function|const) ([A-Za-z]\w*Email)\b/g)) found.push(m[1]!);
    }
    for (const name of found) {
      if (NOT_BUILDERS.has(name)) continue;
      expect({ name, accounted: listedFns.has(name) || name in NOT_LISTED_BUILDERS }).toEqual({ name, accounted: true });
    }
  });
  test("builders left off as retired really have no live caller", () => {
    const srcFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? srcFiles(`${dir}/${d.name}`) : /\.tsx?$/.test(d.name) ? [`${dir}/${d.name}`] : []));
    const files = srcFiles("src").filter((f) => !f.endsWith("template-hub.core.ts"));
    for (const [name, why] of Object.entries(NOT_LISTED_BUILDERS)) {
      if (!why.startsWith("Retired")) continue;
      const callers = files.filter((f) => new RegExp(`\\b${name}\\(`).test(read(f)) && !new RegExp(`export (?:async )?function ${name}\\b`).test(read(f)));
      expect({ name, callers }).toEqual({ name, callers: [] });
    }
  });
});

describe("status shows live / waits for a switch / off", () => {
  const byId = (id: string) => TEMPLATE_ENTRIES.find((e) => e.id === id) as TemplateEntry;
  test("owner email waits for the customer messages switch; text also needs its own switch", () => {
    expect(templateStatus(byId("owner:O18"), { customer_comms: false }).label).toBe("Waits for customer messages switch");
    expect(templateStatus(byId("owner:O18"), { customer_comms: true }).label).toBe("Live");
    expect(templateStatus(byId("owner:sms-quote_ready"), { customer_comms: true }).label).toBe("Waits for its text switch");
    expect(templateStatus(byId("owner:sms-quote_ready"), { customer_comms: true, "sms:quote_ready": true }).label).toBe("Live");
    expect(templateStatus(byId("owner:sms-spot_saved"), { customer_comms: true, spot_saved: true }).label).toBe("Live");
    expect(templateStatus(byId("mitti:A5"), null).label).toBe("Live");
    expect(templateStatus(byId("office:reply-drafts"), null).label).toBe("Off (EMAIL_REPLY_DRAFTS_ENABLED)");
  });
});

describe("the page is read-only", () => {
  test("emails and pages mount in fully sandboxed frames; no send/save endpoints", () => {
    const ui = read("src/components/portal/template-hub.tsx");
    expect(ui.match(/sandbox=""/g)?.length).toBe(2);
    expect(ui).not.toMatch(/send[A-Z]\w*\(|connectMittiForm|createServerFn|setOfficeSwitch|addComplianceTemplate/);
    expect(read("src/lib/template-hub.core.ts")).not.toMatch(/createServerFn|supabase|\.server"/);
  });
  test("Mitti connect stays behind the existing button", () => {
    const card = read("src/components/portal/mitti-forms.tsx");
    expect(card.match(/connect\(\{/g)?.length).toBe(1);
    expect(card).toContain('const displayedId = draft ?? connected ?? "";');
  });
  test("read endpoints check admin access before reading", () => {
    for (const [file, name] of [
      ["src/lib/mitti-forms.functions.ts", "getMittiForms"],
      ["src/lib/office-settings.functions.ts", "getOfficeSwitches"],
      ["src/lib/owner-gates.functions.ts", "paperworkCatalogueFn"],
    ]) {
      const source = read(file).split(`export const ${name} =`)[1]?.split("export const ")[0];
      expect(source).toContain("middleware([requireSupabaseAuth])");
      expect(source).toContain("requireAdmin(context.supabase");
      expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|realMittiCall/);
    }
  });
  test("templates route lives under the admin-only layout", () => {
    expect(read("src/routes/_authenticated/admin.templates.tsx")).toContain('createFileRoute("/_authenticated/admin/templates")');
    expect(read("src/routes/_authenticated/admin.tsx")).toContain("redirect({ to: \"/home\" })");
  });
});
