// Jo 4 Nov 2026: Ready Check A1/A2 ceiling layout, top-ups, approved products and quotes. PURE, no I/O.
// The new Mitti wording REPLACES the old per-area insulation questions; forms on the old wording are read as before
// (`isLayoutForm` false → existing readers). Every total is worked out here from the old R value + the batt chosen —
// the "(makes R…)" text in the Mitti answers is only a hint for the installer and is never trusted.

/** Exact Mitti question wording (Jo 4 Nov 2026), copied character for character. */
export const LAYOUT_Q = {
  areaName: "Which part of the home does this ceiling area cover?",
  areaM2: "Enter the measured ceiling area (m²)",
  old: "Old insulation in this area?",
  oldR: "Old insulation R value?",
  removeM2: "How much existing insulation needs to be removed? (m²)",
  suitable: "Is the existing insulation in good enough condition to lay new insulation over?",
  brand: "Which brand are you installing?",
  batts: "Which batts?",
  goAhead: "Can the job go ahead?",
  thicker: "Owner wants a price for thicker too?",
} as const;

/** Exact Mitti answer wording. */
export const LAYOUT_A = {
  none: "None", out: "Yes, taking it out", topup: "Yes, topping up",
  outR: ["Under R2.0", "R2.0 or more"],
  topupR: ["R0.5", "R1.0", "R1.5", "R2.0 or more"],
  brands: ["Bradford Gold", "Pink Batts", "Earthwool", "Ecowool"],
  battsNew: ["R5.0", "R6.0", "R7.0"],
  battsTopup: {
    "1.5": ["R3.5 (makes R5.0)", "R4.0 Earthwool (makes R5.5)", "R4.1 Bradford or Pink (makes R5.6)", "R5.0 (makes R6.5)"],
    "1": ["R4.0 Earthwool (makes R5.0)", "R4.1 Bradford or Pink (makes R5.1)", "R5.0 (makes R6.0)"],
    "0.5": ["R5.0 (makes R5.5)", "R6.0 Bradford or Pink (makes R6.5)"],
  },
  thicker: ["No", "R6.0 total", "R7.0 total"],
  goAhead: ["Yes", "No"],
} as const;

export type Brand = (typeof LAYOUT_A.brands)[number];
export type ApprovedProduct = { brand: Brand; registerName: string; r: number; model: string; size: string };

/** ESC Register of Products extract, 26 Oct 2026, Activity 48A, all Approved (Jo 4 Nov 2026). */
const P = (brand: Brand, registerName: string, r: number, rows: [string, string][]): ApprovedProduct[] => rows.map(([model, size]) => ({ brand, registerName, r, model, size }));
const BG = "Bradford Gold Ceiling Batt", PK = "PINK Batts Ceiling", EW = "Earthwool Ceiling batt", EC = "ECOWOOL";
export const APPROVED_48A_PRODUCTS: readonly ApprovedProduct[] = [
  ...P("Bradford Gold", BG, 3.5, [["15241", "1160x430"], ["41895", "1160x580"]]),
  ...P("Bradford Gold", BG, 4.1, [["111716", "430"], ["111715", "580"]]),
  ...P("Bradford Gold", BG, 5, [["467911", "430"], ["467912", "580"]]),
  ...P("Bradford Gold", BG, 6, [["467949", "430"], ["467960", "580"]]),
  ...P("Bradford Gold", BG, 7, [["467961", "430"], ["467962", "580"]]),
  ...P("Pink Batts", PK, 2.5, [["4006098", "430"], ["4006099", "580"]]),
  ...P("Pink Batts", PK, 3, [["4006100", "430"], ["4006101", "580"]]),
  ...P("Pink Batts", PK, 3.5, [["4006102", "430"], ["4006103", "580"]]),
  ...P("Pink Batts", PK, 4.1, [["4006039", "1160x430"], ["4006040", "1160x580"], ["4020596", "1200x450"], ["4020597", "1200x600"]]),
  ...P("Pink Batts", PK, 5, [["4006041", "1160x430"], ["4006042", "1160x580"], ["4020598", "1200x450"], ["4020599", "1200x600"]]),
  ...P("Pink Batts", PK, 6, [["4006043", "430"], ["4006044", "580"]]),
  ...P("Pink Batts", PK, 7, [["4006045", "430"], ["4006046", "580"]]),
  ...P("Earthwool", EW, 3.5, [["731840", "430 wide, 175mm"]]),
  ...P("Earthwool", EW, 4, [["731832", "430 wide, 195mm"]]),
  ...P("Earthwool", EW, 5, [["2437543", "430 wide, 210mm"]]),
  ...P("Ecowool", EC, 5, [["602009", "1160x430, 230mm"], ["602010", "1160x580, 230mm"]]),
];

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const rLabel = (r: number) => `R${r1(r).toFixed(1)}`;
const m2Label = (n: number) => `${Number(r2(n).toFixed(2))} m²`;

/** Rule 3: brand + R value → approved product (R4.0 / R4.1 resolve by brand: Earthwool R4.0, Bradford and Pink R4.1). */
export function approvedProduct(brand: Brand | null, r: number | null): { brand: Brand; r: number; models: string[]; registerName: string } | null {
  if (!brand || r == null) return null;
  let want = r1(r);
  if (want === 4 || want === 4.1) want = brand === "Earthwool" ? 4 : 4.1;
  const rows = APPROVED_48A_PRODUCTS.filter((p) => p.brand === brand && p.r === want);
  return rows.length ? { brand, r: want, models: rows.map((p) => p.model), registerName: rows[0]!.registerName } : null;
}
const brandRs = (brand: Brand) => [...new Set(APPROVED_48A_PRODUCTS.filter((p) => p.brand === brand).map((p) => p.r))].sort((a, b) => a - b);

// ---------- reading ----------
type Kid = { label: string; value: unknown };
const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
const vals = (kids: Kid[], q: string) => kids.filter((k) => nrm(k.label) === nrm(q) && k.value != null && String(k.value).trim() !== "").map((k) => String(k.value).trim());
const first = (kids: Kid[], q: string) => vals(kids, q)[0] ?? null;
const rIn = (s: string | null) => { const m = /R\s*(\d+(?:\.\d+)?)/i.exec(s ?? ""); return m ? Number(m[1]) : null; };
const numIn = (s: string | null) => { const n = Number(String(s ?? "").replace(/[^0-9.]/g, "")); return s && Number.isFinite(n) && n > 0 ? n : null; };

/** True when the form uses the 4 Nov wording (the new per-area question is present). */
export const isLayoutForm = (entries: Kid[]) => entries.some((e) => nrm(e.label) === nrm(LAYOUT_Q.old));

export type LayoutArea = { name: string | null; m2: number | null; old: "none" | "out" | "topup" | null; oldR: number | null; oldFailed: boolean; removeM2: number | null; battsR: number | null };

/** One "Add a ceiling area" repeat (all its descendant answers). */
export function readLayoutArea(kids: Kid[], m2Fallback: number | null = null): LayoutArea {
  const o = nrm(first(kids, LAYOUT_Q.old));
  const old = o === nrm(LAYOUT_A.none) ? "none" : o === nrm(LAYOUT_A.out) ? "out" : o === nrm(LAYOUT_A.topup) ? "topup" : null;
  const rv = first(kids, LAYOUT_Q.oldR);
  // Jo 4 Nov follow-up: the Mitti answer is exactly "R2.0 or more" (marked as the failed answer inside Mitti).
  const oldFailed = old !== "none" && /R\s*2(?:\.0)?\s+or more/i.test(rv ?? "");
  const oldR = old === "topup" && !oldFailed ? rIn(rv) : null;
  return {
    name: first(kids, LAYOUT_Q.areaName)?.split("\n")[0]?.trim() || null,
    m2: numIn(first(kids, LAYOUT_Q.areaM2)) ?? m2Fallback,
    old, oldR, oldFailed,
    removeM2: old === "out" ? numIn(first(kids, LAYOUT_Q.removeM2)) : null,
    battsR: rIn(first(kids, LAYOUT_Q.batts)),
  };
}

/** Outcome page + A2 brand. Mitti scores are ignored. */
export function readLayoutOutcome(entries: Kid[]): { goAhead: boolean | null; thicker: 6 | 7 | null; brand: Brand | null } {
  const g = nrm(first(entries, LAYOUT_Q.goAhead));
  const t = first(entries, LAYOUT_Q.thicker);
  const b = first(entries, LAYOUT_Q.brand);
  return {
    goAhead: g === "yes" ? true : g === "no" ? false : null,
    thicker: /R6\.0/.test(t ?? "") ? 6 : /R7\.0/.test(t ?? "") ? 7 : null,
    brand: (LAYOUT_A.brands as readonly string[]).find((x) => nrm(x) === nrm(b)) as Brand | undefined ?? null,
  };
}

// ---------- rules ----------
export type AreaPlan = { ok: boolean; reasons: string[]; newR: number | null; totalR: number | null; product: ReturnType<typeof approvedProduct> };
const areaName = (a: LayoutArea) => a.name ?? "A ceiling area";

/** Rules 1, 2, 3 and 5 for one area with a chosen batt (A2: the form's batt; A1: the boss's pick). */
export function evaluateArea(a: LayoutArea, o: { brand: Brand | null; topupCountsExisting: boolean; target?: number; battsR?: number | null }): AreaPlan {
  const n = areaName(a), target = o.target ?? 5, reasons: string[] = [];
  const bad = (r: string): AreaPlan => ({ ok: false, reasons: [...reasons, r], newR: null, totalR: null, product: null });
  if (!a.old) return bad(`${n}: old insulation answer missing – office review.`);
  if (a.oldFailed) return bad(`${n}: old insulation is R2.0 or more – fails (must be under R2.0).`);
  if (!(a.m2 && a.m2 > 0)) return bad(`${n}: area (m²) missing – office review.`);
  if (a.old === "topup" && a.oldR == null) return bad(`${n}: old insulation R value missing – office review.`);
  const product = approvedProduct(o.brand, o.battsR !== undefined ? o.battsR : a.battsR);
  const picked = o.battsR !== undefined ? o.battsR : a.battsR;
  if (picked == null) return bad(`${n}: batts not chosen – office review.`);
  if (!product) return bad(`${n}: ${o.brand ?? "no brand"} ${rLabel(picked)} is not an approved product – not quoted.`);
  const existing = a.old === "topup" ? a.oldR! : 0;
  const total = r1(existing + product.r);
  if (total < target) return bad(a.old === "topup"
    ? `${n}: ${rLabel(product.r)} over existing ${rLabel(existing)} = ${rLabel(total)} total, under ${rLabel(target)} – not quoted.`
    : `${n}: ${rLabel(product.r)} is under ${rLabel(target)} – not quoted.`);
  if (a.old === "topup" && product.r < 5 && !o.topupCountsExisting)
    return bad(`${n}: top-up batt ${rLabel(product.r)} is under R5.0 and old insulation can't count towards R5.0 (Settings) – office review.`);
  return { ok: true, reasons, newR: product.r, totalR: total, product };
}

/** Exact quote wording, never "about"/"approx". */
export const lineWording = {
  fresh: (r: number, brand: Brand, m2: number) => `${rLabel(r)} ${brand} ceiling batts – ${m2Label(m2)}`,
  topup: (r: number, brand: Brand, oldR: number, total: number, m2: number) => `${rLabel(r)} ${brand} batts over your existing ${rLabel(oldR)} = ${rLabel(total)} total – ${m2Label(m2)}`,
  removal: (m2: number) => `Remove old insulation – ${m2Label(m2)}`,
};

// ---------- A2 pricing ----------
export type RetailPrices = { r5: number | null; topup: number | null; r6: number | null; r7: number | null; removal: number | null };
export type InstallerRatesEx = Partial<Record<"R5_BATTS" | "TOPUP_R5" | "R6_BATTS" | "R7_BATTS" | "REMOVAL", number | null>>;
export type LayoutLine = { code: string; description: string; quantity: number; unit: "m2"; unit_price_inc_gst: number; line_total_inc_gst: number; is_other: false; explanation: null; sort: number };
export type LayoutOption = { target: 5 | 6 | 7; label: string; lines: LayoutLine[]; subtotalIncGst: number; installerCostEx: number; areaM2: number };

/** Smallest approved batt for this brand that brings the area to the target total. */
function battFor(a: LayoutArea, brand: Brand, target: number): number | null {
  const existing = a.old === "topup" ? a.oldR ?? 0 : 0;
  return brandRs(brand).find((r) => r1(existing + r) >= target) ?? null;
}

/** A2: HIV's FIXED retail price for the owner; the installer's rate card is only what HIV pays them. */
export function priceA2Options(i: { areas: LayoutArea[]; brand: Brand | null; thicker: 6 | 7 | null; topupCountsExisting: boolean; retail: RetailPrices; installerRatesEx: InstallerRatesEx; gstRate: number }): { options: LayoutOption[]; reasons: string[] } {
  const reasons: string[] = [];
  if (!i.brand) return { options: [], reasons: ["Brand not chosen on the Ready Check – office review."] };
  if (!i.areas.length) return { options: [], reasons: ["No ceiling areas on the Ready Check – office review."] };
  const build = (target: 5 | 6 | 7): LayoutOption | null => {
    const own: string[] = [];
    type Acc = { code: string; description: string; m2: number; unit: number; payEx: number };
    const acc: Acc[] = [];
    const retailFor = (code: string): number | null => {
      const v = code === "TOPUP_R5" ? i.retail.topup : code === "R6_BATTS" ? i.retail.r6 : code === "R7_BATTS" ? i.retail.r7 : code === "REMOVAL" ? i.retail.removal : i.retail.r5;
      if (v == null || !(v > 0)) { own.push(`${code === "TOPUP_R5" ? "Top-up" : code === "R6_BATTS" ? "R6.0" : code === "R7_BATTS" ? "R7.0" : code === "REMOVAL" ? "Removal" : "R5.0"} retail price is not set – quote held for office review.`); return null; }
      return v;
    };
    const payFor = (code: string): number | null => {
      const v = i.installerRatesEx[code as keyof InstallerRatesEx];
      if (v == null || !(v >= 0)) { own.push(`This installer has no agreed ${code} rate – office must add it before quoting.`); return null; }
      return v;
    };
    for (const a of i.areas) {
      const batt = target === 5 ? a.battsR : (a.old === "topup" || a.battsR !== target ? battFor(a, i.brand!, target) : target);
      if (target !== 5 && batt == null && !a.oldFailed && a.old) { own.push(`${i.brand} can't reach ${rLabel(target)} total in ${areaName(a)} – no thicker option.`); continue; }
      const plan = evaluateArea(a, { brand: i.brand, topupCountsExisting: i.topupCountsExisting, target, battsR: batt });
      if (!plan.ok) { own.push(...plan.reasons); continue; }
      const code = target === 7 ? "R7_BATTS" : target === 6 ? "R6_BATTS" : a.old === "topup" ? "TOPUP_R5" : plan.newR! >= 7 ? "R7_BATTS" : plan.newR! >= 6 ? "R6_BATTS" : "R5_BATTS";
      const unit = retailFor(code), pay = payFor(code);
      if (unit == null || pay == null) continue;
      const description = a.old === "topup" ? lineWording.topup(plan.newR!, i.brand!, a.oldR!, plan.totalR!, 0) : lineWording.fresh(plan.newR!, i.brand!, 0);
      const key = description.replace(/ – .*$/, "");
      const hit = acc.find((x) => x.description === key && x.code === code);
      if (hit) hit.m2 += a.m2!; else acc.push({ code, description: key, m2: a.m2!, unit, payEx: pay });
      if (a.old === "out" && a.removeM2 && a.removeM2 > 0) {
        const ru = retailFor("REMOVAL"), rp = payFor("REMOVAL");
        if (ru != null && rp != null) {
          const r = acc.find((x) => x.code === "REMOVAL");
          if (r) r.m2 += a.removeM2; else acc.push({ code: "REMOVAL", description: "Remove old insulation", m2: a.removeM2, unit: ru, payEx: rp });
        }
      }
    }
    if (own.length) { reasons.push(...[...new Set(own)]); return null; }
    acc.sort((x, y) => (x.code === "REMOVAL" ? 1 : 0) - (y.code === "REMOVAL" ? 1 : 0));
    const lines: LayoutLine[] = acc.map((x, sort) => ({ code: x.code, description: `${x.description} – ${m2Label(x.m2)}`, quantity: r2(x.m2), unit: "m2", unit_price_inc_gst: r2(x.unit), line_total_inc_gst: r2(x.unit * x.m2), is_other: false, explanation: null, sort }));
    return {
      target, label: `${rLabel(target)} total ceiling insulation`, lines,
      subtotalIncGst: r2(lines.reduce((s, l) => s + l.line_total_inc_gst, 0)),
      installerCostEx: r2(acc.reduce((s, x) => s + x.payEx * x.m2, 0)),
      areaM2: r2(i.areas.filter((a) => !a.oldFailed).reduce((s, a) => s + (a.m2 ?? 0), 0)),
    };
  };
  const options: LayoutOption[] = [];
  const main = build(5);
  if (main) options.push(main);
  if (main && i.thicker) { const t = build(i.thicker); if (t) options.push(t); }
  return { options, reasons };
}

// ---------- A1 business-owner price link ----------
export type A1Choice = { brand: Brand; r: number; totalR: number; label: string };
/** Approved brand + batt choices for one area that reach the target total (R5.0, or R6.0/R7.0 for thicker). */
export function a1AreaChoices(a: LayoutArea, target: number, topupCountsExisting = true): A1Choice[] {
  if (!a.old || a.oldFailed) return [];
  const existing = a.old === "topup" ? a.oldR ?? 0 : 0;
  const out: A1Choice[] = [];
  for (const brand of LAYOUT_A.brands) for (const r of brandRs(brand)) {
    const totalR = r1(existing + r);
    if (totalR < target) continue;
    if (a.old === "topup" && r < 5 && !topupCountsExisting) continue;
    out.push({ brand, r, totalR, label: a.old === "topup" ? `${brand} ${rLabel(r)} over existing ${rLabel(existing)} = ${rLabel(totalR)} total` : `${brand} ${rLabel(r)} = ${rLabel(totalR)} total` });
  }
  return out;
}

/** Validates the boss's picks + totals. One main total; a thicker total only when the owner asked for it. */
export function validateA1Price(i: { areas: LayoutArea[]; thicker: 6 | 7 | null; mainPicks: ({ brand: Brand; r: number } | null)[]; mainTotal: number | null; thickerPicks?: ({ brand: Brand; r: number } | null)[]; thickerTotal?: number | null; topupCountsExisting?: boolean }): string[] {
  const out: string[] = [];
  const check = (picks: ({ brand: Brand; r: number } | null)[] | undefined, target: number, pre = "") => i.areas.forEach((a, k) => {
    const p = picks?.[k];
    if (!p) { out.push(`${pre}${areaName(a)}: choose the brand and batts.`); return; }
    const plan = evaluateArea(a, { brand: p.brand, topupCountsExisting: i.topupCountsExisting ?? true, target, battsR: p.r });
    if (!plan.ok) out.push(...plan.reasons.map((r) => pre + r));
  });
  check(i.mainPicks, 5);
  if (!(i.mainTotal != null && i.mainTotal > 0)) out.push("Enter one total price inc GST for the main option.");
  if (i.thicker) {
    check(i.thickerPicks, i.thicker, `Thicker ${rLabel(i.thicker)} option – `);
    if (!(i.thickerTotal != null && i.thickerTotal > 0)) out.push(`Enter a total price inc GST for the thicker ${rLabel(i.thicker)} option the owner asked for.`);
  }
  return out;
}

/** What the business owner sees on the price link: every area's facts and the owner's "thicker too" request. */
export function a1PriceLinkView(areas: LayoutArea[], thicker: 6 | 7 | null) {
  return {
    areas: areas.map((a) => {
      const old = a.old === "none" ? "none" : a.old === "out" ? `taking it out (${a.oldFailed ? "R2.0 or more – fails" : "under R2.0"})` : a.old === "topup" ? `topping up (existing ${a.oldFailed ? "R2.0 or more – fails" : a.oldR != null ? rLabel(a.oldR) : "R value missing"})` : "not answered";
      return { name: areaName(a), facts: [a.m2 != null ? m2Label(a.m2) : "m² missing", `old insulation: ${old}`, ...(a.removeM2 ? [`${m2Label(a.removeM2)} removed`] : [])].join(" · "), main: a1AreaChoices(a, 5), thicker: thicker ? a1AreaChoices(a, thicker) : [] };
    }),
    thicker: thicker ? `The owner also wants a price for ${rLabel(thicker)} total.` : null,
  };
}

// ---------- assembling an owner quote option (both forms) ----------
/** Adds the PIESA + AP fee lines, works out the VEU discount for THIS option and applies the 15% estimate rule.
 *  `veuRawDiscount` comes from wholeVeecDiscount (same area for every option); the $200 minimum is applied per option. */
export function assembleLayoutQuote(o: { label: string; insulationLines: Omit<LayoutLine, "sort">[]; piesaIncGst: number; apFeeIncGst: number; apFeeDescription: string; veuRawDiscount: number; minimumCopayIncGst: number; estimateTotal: number | null; tolerancePct: number; extraHolds?: string[] }) {
  const lines = [
    ...o.insulationLines,
    { code: "PIESA", description: "Mandatory Pre Insulation Electrical Safety Assessment (PIESA)", quantity: 1, unit: "flat" as const, unit_price_inc_gst: o.piesaIncGst, line_total_inc_gst: o.piesaIncGst, is_other: false as const, explanation: null },
    { code: "AP_FEE", description: o.apFeeDescription, quantity: 1, unit: "flat" as const, unit_price_inc_gst: o.apFeeIncGst, line_total_inc_gst: o.apFeeIncGst, is_other: false as const, explanation: null },
  ].map((l, sort) => ({ ...l, sort }));
  const subtotal = r2(lines.reduce((s, l) => s + l.line_total_inc_gst, 0));
  const raw = Math.max(0, o.veuRawDiscount);
  const veu = r2(Math.min(raw, Math.max(0, subtotal - o.minimumCopayIncGst)));
  const total = r2(subtotal - veu);
  const holds = [...(o.extraHolds ?? [])];
  if (o.estimateTotal != null && o.estimateTotal > 0) {
    const pct = (Math.abs(total - o.estimateTotal) / o.estimateTotal) * 100;
    if (pct > o.tolerancePct) holds.push(`${o.label}: $${total.toFixed(2)} is ${pct.toFixed(1)}% off the owner's estimate of $${o.estimateTotal.toFixed(2)} (more than ${o.tolerancePct}%) – office review.`);
  }
  return { label: o.label, lines, subtotalIncGst: subtotal, veuDiscountIncGst: veu, reducedForMinimum: veu < raw, customerTotalIncGst: total, holds };
}

// ---------- A1 owner quote wording + option groups (Jo 4 Nov follow-up) ----------
export type A1Pick = { brand: Brand; r: number } | null;
/** One exact line per area (plus its own removal line), from the boss's approved picks. Never "about". */
export function a1QuoteLines(areas: LayoutArea[], picks: A1Pick[]): string[] {
  const out: string[] = [];
  areas.forEach((a, k) => {
    const p = picks[k];
    const prod = p ? approvedProduct(p.brand, p.r) : null;
    if (!prod || !(a.m2 && a.m2 > 0) || a.oldFailed) return;
    out.push(a.old === "topup" && a.oldR != null ? lineWording.topup(prod.r, prod.brand, a.oldR, r1(a.oldR + prod.r), a.m2) : lineWording.fresh(prod.r, prod.brand, a.m2));
    if (a.old === "out" && a.removeM2 && a.removeM2 > 0) out.push(lineWording.removal(a.removeM2));
  });
  return out;
}

export const A1_THICKER_CODE = "INSTALLER_A1_THICKER";
/** Quote options that go to the owner together: the main option and its "thicker too" companion(s). */
const OPTION_GROUPS: readonly (readonly string[])[] = [["INSTALLER_A1", A1_THICKER_CODE], ["LAYOUT_R5", "LAYOUT_R6", "LAYOUT_R7"]];
export const optionGroupFor = (code: string | null | undefined): readonly string[] => OPTION_GROUPS.find((g) => g.includes(String(code ?? ""))) ?? [String(code ?? "")];
export const isThickerOptionCode = (code: string | null | undefined) => code === A1_THICKER_CODE || code === "LAYOUT_R6" || code === "LAYOUT_R7";
