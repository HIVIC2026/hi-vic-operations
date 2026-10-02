// Shows what we read from the certificate next to what the applicant typed. Nothing is applied
// unless the applicant presses "Use" (one field) or "Use all read details".
import { useState } from "react";
import { acceptedPatch, compareReading, type InsuranceExtract, type InsuranceField, type ReadRow } from "@/lib/insurance-reading.core";

const fmt = (r: ReadRow, v: string | number | null) => {
  if (v === null) return "—";
  if (r.field === "public_liability_cover_amount" && typeof v === "number") return `$${v.toLocaleString("en-AU")}`;
  if (r.field === "public_liability_expiry" && typeof v === "string") { const [y, m, d] = v.split("-"); return `${d}/${m}/${y}`; }
  return String(v);
};

export function InsuranceReadReview({ extracted, typed, onAccept, accent }: {
  extracted: InsuranceExtract;
  typed: Partial<Record<InsuranceField, string | number | null>>;
  onAccept: (patch: Partial<Record<InsuranceField, string | number>>) => void;
  accent: string;
}) {
  const [done, setDone] = useState<InsuranceField[]>([]);
  const rows = compareReading(typed, extracted);
  const open = rows.filter((r) => (r.status === "fill" || r.status === "conflict") && !done.includes(r.field));
  const accept = (fields: InsuranceField[]) => { onAccept(acceptedPatch(rows, fields)); setDone((p) => [...p, ...fields]); };
  const btn = { minHeight: 44, padding: "0 14px", borderRadius: 10, border: `1.5px solid ${accent}`, background: "#fff", color: accent, fontWeight: 700, cursor: "pointer" } as const;
  return (
    <section aria-label="Details read from your certificate" style={{ border: "1px solid #D8DEEA", borderRadius: 14, padding: 14, background: "#F7F9FC" }}>
      <strong>Details read from your certificate</strong>
      <p style={{ margin: "4px 0 10px", fontSize: 14, color: "#5B6478" }}>Please check these. We only change your answers if you choose to use a value.</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((r) => {
          const used = done.includes(r.field);
          return (
            <li key={r.field} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #E4E8F0" }}>
              <span style={{ minWidth: 150, fontWeight: 600 }}>{r.label}</span>
              <span style={{ flex: 1, minWidth: 140 }}>
                Read: <b>{fmt(r, r.read)}</b>
                {r.status === "unread" && <span style={{ color: "#5B6478" }}> — couldn't read, please type it</span>}
                {r.status === "same" && <span style={{ color: "#067647" }}> ✓ matches what you entered</span>}
                {r.status === "conflict" && !used && <span style={{ color: "#B54708" }}> — you entered {fmt(r, r.typed)}</span>}
                {used && <span style={{ color: "#067647" }}> ✓ used</span>}
              </span>
              {(r.status === "fill" || r.status === "conflict") && !used && <button type="button" style={btn} onClick={() => accept([r.field])} aria-label={`Use ${r.label} read from certificate`}>Use</button>}
            </li>
          );
        })}
      </ul>
      {open.length > 1 && <button type="button" style={{ ...btn, marginTop: 10 }} onClick={() => accept(open.map((r) => r.field))}>Use all read details</button>}
    </section>
  );
}
