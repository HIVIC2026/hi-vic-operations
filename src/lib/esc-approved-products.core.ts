/**
 * ESC VEU Activity 48 approved ceiling insulation products — pure.
 *
 * Source: ESC published register extract dated 19 October 2026, supplied by Jo 24 Oct 2026 (decision 149): 33 models
 * (10 Bradford, 3 Earthwool, 2 ECOWOOL, 18 Pink Batts). Every entry: product category 48A, "Bulk insulation batt or
 * blanket", status Approved, effective from 14 April 2026. `code` is the manufacturer model code (the extract has no
 * separate ESC product ID). `family` is the product name as listed; when the register changes, replace this list and
 * bump REGISTER_SOURCE_DATE.
 *
 * Lower-R products stay in the catalogue (they can be combined); the Activity 48 minimum is checked separately.
 */
export const REGISTER_SOURCE_DATE = "2026-10-19";
export const REGISTER_EFFECTIVE_FROM = "2026-04-14";
export const PRODUCT_CATEGORY = "48A" as const;
export const PRODUCT_TYPE = "Bulk insulation batt or blanket";
export const ACTIVITY_48_MIN_R = 5.0;

export type EscProduct = {
  family: string; brand: "Bradford" | "Earthwool" | "ECOWOOL" | "Pink Batts"; code: string;
  rValue: number; lengthMm: number; widthMm: number; thicknessMm: number | null; effectiveTo: string;
};

export const ESC_APPROVED_PRODUCTS: readonly EscProduct[] = [
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "15241", rValue: 3.5, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-05-28" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "41895", rValue: 3.5, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-05-28" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "111716", rValue: 4.1, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-05-28" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "111715", rValue: 4.1, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-05-28" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "467911", rValue: 5.0, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-05-28" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "467912", rValue: 5.0, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-05-28" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "467949", rValue: 6.0, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-05-28" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "467960", rValue: 6.0, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-05-28" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "467961", rValue: 7.0, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-05-20" },
  { family: "CSR Bradford Gold Ceiling Batt", brand: "Bradford", code: "467962", rValue: 7.0, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-05-20" },
  { family: "Earthwool Ceiling batt", brand: "Earthwool", code: "731840", rValue: 3.5, lengthMm: 1160, widthMm: 430, thicknessMm: 175, effectiveTo: "2027-02-23" },
  { family: "Earthwool Ceiling batt", brand: "Earthwool", code: "731832", rValue: 4.0, lengthMm: 1160, widthMm: 430, thicknessMm: 195, effectiveTo: "2027-02-23" },
  { family: "Earthwool Ceiling batt", brand: "Earthwool", code: "2437543", rValue: 5.0, lengthMm: 1160, widthMm: 430, thicknessMm: 210, effectiveTo: "2027-02-23" },
  { family: "ECOWOOL ® Insulation", brand: "ECOWOOL", code: "602009", rValue: 5.0, lengthMm: 1160, widthMm: 430, thicknessMm: 230, effectiveTo: "2029-05-08" },
  { family: "ECOWOOL ® Insulation", brand: "ECOWOOL", code: "602010", rValue: 5.0, lengthMm: 1160, widthMm: 580, thicknessMm: 230, effectiveTo: "2029-05-08" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006098", rValue: 2.5, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006099", rValue: 2.5, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006100", rValue: 3.0, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006101", rValue: 3.0, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006102", rValue: 3.5, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006103", rValue: 3.5, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006039", rValue: 4.1, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4020596", rValue: 4.1, lengthMm: 1200, widthMm: 450, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006040", rValue: 4.1, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4020597", rValue: 4.1, lengthMm: 1200, widthMm: 600, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006041", rValue: 5.0, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4020598", rValue: 5.0, lengthMm: 1200, widthMm: 450, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006042", rValue: 5.0, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4020599", rValue: 5.0, lengthMm: 1200, widthMm: 600, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006043", rValue: 6.0, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006044", rValue: 6.0, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006045", rValue: 7.0, lengthMm: 1160, widthMm: 430, thicknessMm: null, effectiveTo: "2029-08-02" },
  { family: "PINK® Batts Ceiling Insulation", brand: "Pink Batts", code: "4006046", rValue: 7.0, lengthMm: 1160, widthMm: 580, thicknessMm: null, effectiveTo: "2029-08-02" },
];

const rText = (r: number) => `R${r.toFixed(1)}`;

/** Dropdown label, e.g. "CSR Bradford Gold Ceiling Batt — R5.0 — 1160 × 430 mm — 467911". */
export const productLabel = (p: EscProduct) => `${p.family} — ${rText(p.rValue)} — ${p.lengthMm} × ${p.widthMm} mm — ${p.code}`;

export const productByCode = (code: string | null | undefined) => ESC_APPROVED_PRODUCTS.find((p) => p.code === String(code ?? "").trim()) ?? null;

/** Approved on that day (inclusive of both ends), using the register's effective dates. */
export function approvedOn(p: EscProduct, isoDate: string): boolean {
  const d = isoDate.slice(0, 10);
  return d >= REGISTER_EFFECTIVE_FROM && d <= p.effectiveTo;
}

/**
 * Installed product(s) for one area: every product must be on the register and in date on the install day, and the
 * R-values together must reach R5.0. Returns the problems in plain words ([] = OK).
 */
export function activity48ProductProblems(codes: readonly string[], installDate: string): string[] {
  if (!codes.length) return ["No installed product recorded."];
  const out: string[] = [];
  let total = 0;
  for (const c of codes) {
    const p = productByCode(c);
    if (!p) { out.push(`Product ${c} is not on the ESC approved list.`); continue; }
    if (!approvedOn(p, installDate)) out.push(`${productLabel(p)} is not approved on ${installDate.slice(0, 10)} (approved ${REGISTER_EFFECTIVE_FROM} to ${p.effectiveTo}).`);
    total += p.rValue;
  }
  if (!out.length && total + 1e-9 < ACTIVITY_48_MIN_R) out.push(`Installed R-value ${rText(total)} is below the Activity 48 minimum of ${rText(ACTIVITY_48_MIN_R)}.`);
  return out;
}

/** Register models that match one of Jo's six Mitti tap options ("Bradford Gold R6", "Fletchers Pink Batts R5"). */
export function modelsForMittiOption(option: string): EscProduct[] {
  const m = option.match(/R(\d+(?:\.\d+)?)\s*$/i);
  const r = m ? Number(m[1]) : NaN;
  const brand = /bradford/i.test(option) ? "Bradford" : /pink batts/i.test(option) ? "Pink Batts" : /earthwool/i.test(option) ? "Earthwool" : /ecowool/i.test(option) ? "ECOWOOL" : null;
  return ESC_APPROVED_PRODUCTS.filter((p) => p.brand === brand && Math.abs(p.rValue - r) < 1e-9);
}
