// Fake Mitti only – no network, no database. Run: bun test ./tests/
import { describe, expect, test } from "bun:test";
import { MITTI_TEMPLATE_ID, buildPrefill, createOrReuseAudit, mittiApi, parseAudit, planSync, type CreateCtx, type MittiCall } from "../src/lib/mitti.core";

const TEMPLATE = {
  template_id: MITTI_TEMPLATE_ID,
  header_items: [
    { item_id: "h1", label: "Portal Job Number", type: "text" },
    { item_id: "h2", label: "Site address", type: "address" },
    { item_id: "h3", label: "Owner name", type: "text" },
    { item_id: "h4", label: "Owner email", type: "text" },
    { item_id: "h5", label: "Assigned Electrician / Assessor", type: "text" },
    { item_id: "h6", label: "Assessment date/time", type: "datetime" },
  ],
  items: [
    { item_id: "s1", label: "Office details", type: "section" },
    { item_id: "i1", parent_id: "s1", label: "Office estimated ceiling area (m²)", type: "text" },
    { item_id: "i2", parent_id: "s1", label: "Occupancy", type: "text" },
    { item_id: "i3", parent_id: "s1", label: "Life support status", type: "text" },
  ],
};

function fake(opts: { users?: { id: string; email: string }[]; template?: unknown; audit?: unknown } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let n = 0;
  const call: MittiCall = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === "/users/search") return { users: opts.users ?? [{ id: "user_77", email: "sparky@hivic.test" }] };
    if (path.startsWith("/templates/")) return opts.template ?? TEMPLATE;
    if (path === "/audits") return { audit_id: `audit_${++n}`, created_at: "2026-09-28T01:00:00Z" };
    if (path.endsWith("/share")) return {};
    if (path.startsWith("/audits/")) return opts.audit;
    throw new Error("unexpected " + path);
  };
  return { api: mittiApi(call), calls };
}

const ctx = (over: Partial<CreateCtx> = {}): CreateCtx => ({
  businessUnit: "hivic", stage: "assessment_booked", jobNumber: "HV-1020", existingAuditId: null, electricianEmail: "sparky@hivic.test",
  prefill: { jobNumber: "HV-1020", address: "1 Test St, Brunswick, 3056", ownerName: "Ann Owner", ownerEmail: "ann@example.com", assessorName: "Sam Sparky", assessmentAt: "2026-09-30T00:00:00Z", estimatedAreaM2: 120, occupancy: "owner occupied", lifeSupport: "None recorded by office" },
  ...over,
});

describe("create & assign", () => {
  test("exact template, label-based prefill, share edit to assigned user", async () => {
    const { api, calls } = fake();
    const r = await createOrReuseAudit(api, ctx());
    expect(r).toMatchObject({ auditId: "audit_1", reused: false, mittiUserId: "user_77", prefillCount: 9 });
    expect(calls.map((c) => c.path)).toEqual(["/users/search", `/templates/${MITTI_TEMPLATE_ID}`, "/audits", "/audits/audit_1/share"]);
    expect(calls[0].body).toEqual({ email: ["sparky@hivic.test"] });
    const body = calls[2].body as { template_id: string; header_items: { item_id: string; responses: Record<string, string> }[]; items: { item_id: string }[] };
    expect(body.template_id).toBe(MITTI_TEMPLATE_ID);
    expect(body.header_items.find((h) => h.item_id === "h1")?.responses.text).toBe("HV-1020");
    expect(body.header_items.find((h) => h.item_id === "h6")?.responses.datetime).toBe("2026-09-30T00:00:00Z");
    expect(body.items.map((i) => i.item_id).sort()).toEqual(["i1", "i2", "i3"]);
    expect(calls[3].body).toEqual({ shares: [{ id: "user_77", permission: "edit" }] });
  });
  test("retry reuses the stored audit and only re-shares", async () => {
    const { api, calls } = fake();
    const r = await createOrReuseAudit(api, ctx({ existingAuditId: "audit_existing" }));
    expect(r.reused).toBe(true);
    expect(r.auditId).toBe("audit_existing");
    expect(calls.some((c) => c.path === "/audits")).toBe(false);
  });
  test("missing / wrong Mitti user blocks before creation", async () => {
    const { api, calls } = fake({ users: [{ id: "x", email: "other@hivic.test" }] });
    await expect(createOrReuseAudit(api, ctx())).rejects.toThrow(/not found in Mitti/);
    expect(calls.some((c) => c.path === "/audits")).toBe(false);
    await expect(createOrReuseAudit(fake().api, ctx({ electricianEmail: null }))).rejects.toThrow(/email/);
  });
  test("guards: business unit, stage, missing mandatory template labels", async () => {
    await expect(createOrReuseAudit(fake().api, ctx({ businessUnit: "dc" }))).rejects.toThrow(/Home Insulation Victoria/);
    await expect(createOrReuseAudit(fake().api, ctx({ stage: "eligibility_review" }))).rejects.toThrow(/Assessment Booking/);
    const { api, calls } = fake({ template: { template_id: MITTI_TEMPLATE_ID, header_items: [{ item_id: "h1", label: "Portal Job Number" }], items: [] } });
    await expect(createOrReuseAudit(api, ctx())).rejects.toThrow(/missing required office fields/);
    expect(calls.some((c) => c.path === "/audits")).toBe(false);
  });
  test("prefill count excludes empty values", () => {
    expect(buildPrefill(TEMPLATE, { ...ctx().prefill, ownerEmail: null, estimatedAreaM2: null }).count).toBe(7);
  });
});

const sel = (label: string) => ({ selected: [{ label }] });
function audit(over: { completed?: boolean; jobNumber?: string; template?: string; extra?: unknown[] } = {}) {
  return {
    audit_id: "audit_1", template_id: over.template ?? MITTI_TEMPLATE_ID, modified_at: "2026-09-30T03:00:00Z",
    audit_data: { template_id: over.template ?? MITTI_TEMPLATE_ID, date_completed: over.completed ? "2026-09-30T03:00:00Z" : null, date_modified: "2026-09-30T03:00:00Z" },
    header_items: [{ item_id: "h1", label: "Portal Job Number", responses: { text: over.jobNumber ?? "HV-1020" } }],
    items: [
      { item_id: "m", label: "Measure-up", type: "section" },
      { item_id: "g", parent_id: "m", label: "Gross ceiling area (m²)", responses: { text: "150" } },
      { item_id: "x", parent_id: "m", label: "Excluded area (m²)", responses: { text: "12.5" } },
      { item_id: "n", parent_id: "m", label: "Net insulation area (m²) = Gross minus Excluded", responses: { text: "137.5" } },
      { item_id: "e", label: "Existing insulation", type: "section", children: [
        { item_id: "e1", label: "Existing insulation present?", responses: sel("Yes") },
        { item_id: "e2", label: "Existing R-value", responses: { text: "R1.5" } },
        { item_id: "e3", label: "Removal required?", responses: sel("Yes") },
        { item_id: "e4", label: "Removal area (m²)", responses: { text: "40" } },
      ] },
      { item_id: "a1", label: "Ceiling access", responses: sel("Moderate – tight manhole") },
      { item_id: "d1", label: "Number of downlights", responses: { text: "14" } },
      { item_id: "d2", label: "Downlights requiring upgrade", responses: { text: "6" } },
      { item_id: "d3", label: "Downlight type", responses: { text: "Halogen" } },
      { item_id: "f1", label: "Number of exhaust fans", responses: { text: "2" } },
      { item_id: "f2", label: "Exhaust fans requiring clearance", responses: { text: "1" } },
      { item_id: "sb", label: "Switchboard upgrade required?", responses: sel("No") },
      { item_id: "r1", label: "RCDs present?", responses: sel("No") },
      { item_id: "r2", label: "RCDs required", responses: { text: "2" } },
      { item_id: "p", label: "PIESA", type: "section" },
      { item_id: "p1", parent_id: "p", label: "Life support equipment onsite?", responses: sel("No") },
      { item_id: "p2", parent_id: "p", label: "PIESA outcome", responses: sel("Rectification required") },
      { item_id: "p3", parent_id: "p", label: "PIESA assessment date", responses: { datetime: "2026-09-29T23:30:00Z" } },
      { item_id: "w", label: "Other work item", type: "section" },
      { item_id: "w1", parent_id: "w", label: "Work item description", responses: { text: "Replace damaged junction box" } },
      { item_id: "w2", parent_id: "w", label: "Quantity", responses: { text: "2" } },
      { item_id: "w3", parent_id: "w", label: "Proposed total price inc GST", responses: { text: "$330" } },
      { item_id: "w4", parent_id: "w", label: "Explanation", responses: { text: "Heat damaged" } },
      { item_id: "v", label: "Other work item 2", type: "section" },
      { item_id: "v1", parent_id: "v", label: "Work item description", responses: { text: "Relocate cabling" } },
      { item_id: "v2", parent_id: "v", label: "Quantity", responses: { text: "1" } },
      { item_id: "cp", label: "Circuit protection work required", responses: sel("Yes") },
      { item_id: "cr", label: "Cable replacement required", responses: sel("No") },
      { item_id: "fn", label: "Assessor notes", responses: { text: "Tight access near eaves." } },
      ...(over.extra ?? []),
    ],
  };
}

describe("sync mapping", () => {
  const base = { storedAuditId: "audit_1", jobNumber: "HV-1020", assessmentStatus: "draft" };
  test("maps area, insulation/R, removal, access, electrical, PIESA outcome/date", () => {
    const p = planSync(audit({ completed: true }), base);
    if (p.locked) throw new Error("locked");
    expect(p.patch).toMatchObject({
      measured_area_m2: 137.5, insulation_present: true, existing_r_value: 1.5, removal_required: true, removal_m2: 40,
      access_difficulty: "moderate", downlights_qty: 14, downlights_upgrade_qty: 6, downlights_type: "Halogen",
      exhaust_fans_qty: 2, exhaust_fans_clearance_qty: 1, switchboard_condition: "ok", rcds_present: false, rcds_required_qty: 2,
      life_support_confirmed: false, piesa_outcome: "fail", assessed_on: "2026-09-30", notes: "Tight access near eaves.",
    });
    expect(p.syncStatus).toBe("synced");
  });
  test("completed audit never carries status/completion fields", () => {
    const p = planSync(audit({ completed: true }), base);
    if (p.locked) throw new Error("locked");
    for (const k of ["status", "completed_at", "stage"]) expect(k in p.patch).toBe(false);
  });
  test("incomplete audit stays pending; ambiguous PIESA stays pending", () => {
    const a = audit();
    a.items = a.items.filter((i) => i.item_id !== "p2");
    const p = planSync(a, base);
    if (p.locked) throw new Error("locked");
    expect(p.syncStatus).toBe("pending");
    expect(p.patch.piesa_outcome).toBeUndefined();
  });
  test("'No rectification required' is preliminary B1 only (never pass); gross − excluded fallback", () => {
    const a = audit();
    a.items = a.items.filter((i) => i.item_id !== "n").map((i) => (i.item_id === "p2" ? { ...i, responses: sel("No rectification required") } : i));
    const p = parseAudit(a);
    expect(p.patch.piesa_outcome).toBeUndefined();
    expect(p.issues.some((i) => /preliminary B1/.test(i))).toBe(true);
    expect(p.patch.measured_area_m2).toBe(137.5);
  });
  test("job number / template mismatch fails closed", () => {
    expect(() => planSync(audit({ jobNumber: "HV-9999" }), base)).toThrow(/does not match/);
    expect(() => planSync(audit({ template: "template_other" }), base)).toThrow(/template/);
    expect(() => planSync(audit(), { ...base, storedAuditId: "audit_other" })).toThrow(/different audit/);
  });
  test("completed Lovable assessment is immutable", () => {
    expect(planSync(audit({ completed: true }), { ...base, assessmentStatus: "complete" })).toEqual({ locked: true });
  });
  test("non-standard items: stable keys, derived unit price, never invented", () => {
    const a = parseAudit(audit()), b = parseAudit(audit());
    expect(a.others.map((o) => o.external_key)).toEqual(b.others.map((o) => o.external_key));
    const jb = a.others.find((o) => o.description === "Replace damaged junction box")!;
    expect(jb).toMatchObject({ quantity: 2, unit_price_inc_gst: 165, needs_office_pricing: false });
    const rc = a.others.find((o) => o.description === "Relocate cabling")!;
    expect(rc).toMatchObject({ unit_price_inc_gst: null, needs_office_pricing: true });
  });
  test("unsupported electrical work → manual review, no rate; 'No' answers ignored", () => {
    const o = parseAudit(audit()).others.filter((x) => x.unsupported);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ unit_price_inc_gst: null, needs_office_pricing: true });
    expect(o[0].description).toMatch(/Circuit protection/);
  });
  test("switchboard only set when explicit", () => {
    const a = audit();
    a.items = a.items.filter((i) => i.item_id !== "sb");
    expect(parseAudit(a).patch.switchboard_condition).toBeUndefined();
    a.items.push({ item_id: "sb2", label: "Switchboard condition", responses: sel("Upgrade required") });
    expect(parseAudit(a).patch.switchboard_condition).toBe("upgrade_required");
  });
});

describe("correctness hardening", () => {
  const withItem = (id: string, text: string) => { const a = audit(); a.items = a.items.map((i) => (i.item_id === id ? { ...i, responses: { text } } : i)); return a; };
  test("blank required prefill blocks before any audit is created", async () => {
    for (const k of ["jobNumber", "address", "ownerName", "assessorName"] as const) {
      const { api, calls } = fake();
      await expect(createOrReuseAudit(api, ctx({ prefill: { ...ctx().prefill, [k]: "   " } }))).rejects.toThrow(/blank/);
      expect(calls.some((c) => c.path === "/audits")).toBe(false);
    }
  });
  test("ambiguous prefix mapping blocks creation", async () => {
    const t = { ...TEMPLATE, header_items: [...TEMPLATE.header_items.filter((h) => h.item_id !== "h2"), { item_id: "a1", label: "Site address line 1" }, { item_id: "a2", label: "Site address line 2" }] };
    const { api, calls } = fake({ template: t });
    await expect(createOrReuseAudit(api, ctx())).rejects.toThrow(/ambiguous/);
    expect(calls.some((c) => c.path === "/audits")).toBe(false);
  });
  test("duplicate exact labels are ambiguous and block creation", async () => {
    for (const dup of ["Site address", "Portal Job Number"]) {
      const t = { ...TEMPLATE, header_items: [...TEMPLATE.header_items, { item_id: `dup_${dup}`, label: dup, type: "text" }] };
      const { api, calls } = fake({ template: t });
      await expect(createOrReuseAudit(api, ctx())).rejects.toThrow(/ambiguous/);
      expect(calls.some((c) => c.path === "/audits")).toBe(false);
    }
  });
  test("duplicate exact on one alias is not escaped by a unique exact on another alias", async () => {
    const t = { ...TEMPLATE, header_items: [...TEMPLATE.header_items, { item_id: "dup_addr", label: "Site address", type: "address" }] };
    const { api, calls } = fake({ template: t });
    await expect(createOrReuseAudit(api, ctx())).rejects.toThrow(/ambiguous/);
    expect(calls.some((c) => c.path === "/audits")).toBe(false);
  });
  test("unique exact label still wins over merely-prefix variants", async () => {
    const t = { ...TEMPLATE, header_items: [...TEMPLATE.header_items, { item_id: "x1", label: "Site address line 2", type: "text" }] };
    const { api } = fake({ template: t });
    const auditRef = await createOrReuseAudit(api, ctx());
    expect(auditRef.auditId).toMatch(/^audit_/);
  });
  test("repeated-zone area fields never become whole-house area", () => {
    const a = audit({ extra: [{ item_id: "n2", label: "Net insulation area", responses: { text: "60" } }] });
    const p = parseAudit(a);
    expect(p.patch.measured_area_m2).toBeUndefined();
    expect(p.issues.some((i) => /Repeated ceiling area/.test(i))).toBe(true);
  });
  test("malformed / negative measurements and R-values are rejected with review issues", () => {
    for (const [id, text, key] of [["n", "about 137", "measured_area_m2"], ["n", "-5", "measured_area_m2"], ["n", "12abc", "measured_area_m2"], ["e2", "R-1.5", "existing_r_value"], ["e2", "Infinity", "existing_r_value"], ["e4", "-40", "removal_m2"]] as const) {
      const a = audit(); a.items = a.items.map((i) => (i.item_id === "e" ? { ...i, children: i.children!.map((c) => (c.item_id === id ? { ...c, responses: { text } } : c)) } : i.item_id === id ? { ...i, responses: { text } } : i));
      const p = parseAudit(a);
      if (key === "measured_area_m2") expect(p.patch.measured_area_m2).not.toBe(137.5);
      else expect((p.patch as Record<string, unknown>)[key]).toBeUndefined();
      expect(p.issues.some((i) => /not a valid number|negative/.test(i))).toBe(true);
    }
  });
  test("safe legacy numeric forms still parse", () => {
    expect(parseAudit(withItem("n", "137.5 m²")).patch.measured_area_m2).toBe(137.5);
    expect(parseAudit(withItem("n", "1,137.5")).patch.measured_area_m2).toBe(1137.5);
  });
  test("fractional and negative counts are rejected, never rounded", () => {
    const f = parseAudit(withItem("d1", "14.6"));
    expect(f.patch.downlights_qty).toBeUndefined();
    expect(f.issues.some((i) => /whole number/.test(i))).toBe(true);
    const n = parseAudit(withItem("r2", "-2"));
    expect(n.patch.rcds_required_qty).toBeUndefined();
    expect(n.issues.some((i) => /negative/.test(i))).toBe(true);
  });
  test("incomplete B1 clearance never yields PIESA pass and sync stays non-completing", () => {
    const a = audit({ completed: true }); a.items = a.items.map((i) => (i.item_id === "p2" ? { ...i, responses: sel("No rectification required") } : i));
    const p = planSync(a, { storedAuditId: "audit_1", jobNumber: "HV-1020", assessmentStatus: "draft" });
    if (p.locked) throw new Error("locked");
    expect(p.patch.piesa_outcome).toBeUndefined();
    for (const k of ["status", "completed_at", "stage"]) expect(k in p.patch).toBe(false);
    expect(p.snapshot.length).toBeGreaterThan(0);
  });
});
