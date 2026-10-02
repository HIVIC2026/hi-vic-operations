// Pure rules for turning what the AI read from a Certificate of Currency into values the applicant can
// confirm. Nothing here writes to the application: typed details stay authoritative until the applicant
// explicitly accepts a read value. Tested by tests/insurance-reading.test.ts.

export type InsuranceExtract = {
  insured_name: string | null; insurer: string | null; policy_number: string | null;
  cover_amount: number | null; expiry: string | null; is_public_liability: boolean | null;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Australian date reading: YYYY-MM-DD, DD/MM/YYYY (never MM/DD), "30 June 2027", "4pm 30/06/2027". */
export function parseAuDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return validDate(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) { const y = +m[3]!; return validDate(y < 100 ? 2000 + y : y, +m[2]!, +m[1]!); }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m) { const mo = MONTHS[m[2]!.slice(0, m[2]!.startsWith("sept") ? 4 : 3)]; return mo ? validDate(+m[3]!, mo, +m[1]!) : null; }
  return null;
}

/** "$20,000,000", "20m", "$20 million", "AUD 10,000,000", 20000000 → number. Anything unclear → null. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 1000 && v <= 1e10 ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const s = v.toLowerCase().replace(/aud|a\$|\$|\s/g, "").replace(/,/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(m|mil|million|k|thousand)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]!) * (m[2]?.startsWith("m") ? 1_000_000 : m[2] ? 1_000 : 1);
  return n >= 1000 && n <= 1e10 ? Math.round(n) : null;
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && !/^(n\/?a|null|unknown|not shown)$/i.test(v.trim()) ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/** Cleans the AI's raw answer. Unreadable values become null — never a guess. */
export function normaliseExtract(raw: Record<string, unknown> | null | undefined): InsuranceExtract | null {
  if (!raw || typeof raw !== "object") return null;
  const out: InsuranceExtract = {
    insured_name: text(raw.insured_name, 200), insurer: text(raw.insurer, 200), policy_number: text(raw.policy_number, 100),
    cover_amount: parseAmount(raw.cover_amount), expiry: parseAuDate(raw.expiry),
    is_public_liability: typeof raw.is_public_liability === "boolean" ? raw.is_public_liability : null,
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

export type InsuranceField = "insurer" | "insurance_policy_number" | "public_liability_cover_amount" | "public_liability_expiry";
export type ReadRow = { field: InsuranceField; label: string; typed: string | number | null; read: string | number | null; status: "same" | "fill" | "conflict" | "unread" };

const FIELDS: { field: InsuranceField; label: string; from: keyof InsuranceExtract }[] = [
  { field: "insurer", label: "Insurer", from: "insurer" },
  { field: "insurance_policy_number", label: "Policy number", from: "policy_number" },
  { field: "public_liability_cover_amount", label: "Public liability cover", from: "cover_amount" },
  { field: "public_liability_expiry", label: "Expiry date", from: "expiry" },
];

const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" ? a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ") : a === b;
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

/** Side-by-side of what was typed and what was read, per field. */
export function compareReading(typed: Partial<Record<InsuranceField, string | number | null>>, x: InsuranceExtract | null): ReadRow[] {
  return FIELDS.map(({ field, label, from }) => {
    const t = blank(typed[field]) ? null : (typed[field] as string | number);
    const r = x ? (x[from] as string | number | null) : null;
    const status: ReadRow["status"] = r === null ? "unread" : t === null ? "fill" : same(t, r) ? "same" : "conflict";
    return { field, label, typed: t, read: r, status };
  });
}

/** Only the rows the applicant explicitly accepted are applied. */
export function acceptedPatch(rows: ReadRow[], accepted: InsuranceField[]): Partial<Record<InsuranceField, string | number>> {
  const out: Partial<Record<InsuranceField, string | number>> = {};
  for (const r of rows) if (accepted.includes(r.field) && r.read !== null && r.status !== "same") out[r.field] = r.read;
  return out;
}
