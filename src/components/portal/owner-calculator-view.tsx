import { CheckCircle2 } from "lucide-react";
import { SPOT_SAVED_BODY, SPOT_SAVED_HEADING } from "@/lib/save-spot-offer.core";

export type SavedResponse = { spot_saved_at: string | null; opted_out_at: string | null; saved_area_m2?: number | string | null; saved_total?: number | string | null; saved_veu_discount?: number | string | null };
type ModeData = { estimate?: { estimate?: { calc?: unknown } }; response?: SavedResponse | null } | null | undefined;

/** Which screen the owner calculator shows. An already-saved spot always wins over the calculator/offer (keep=original or not). */
export function ownerCalculatorMode({ data, loading, error }: { data: ModeData; loading: boolean; error: boolean }): "loading" | "unavailable" | "opted_out" | "saved" | "offer" {
  if (loading) return "loading";
  if (error || !data) return "unavailable";
  if (data.response?.opted_out_at) return "opted_out";
  if (data.response?.spot_saved_at) return "saved";
  if (!data.estimate?.estimate?.calc) return "unavailable";
  return "offer";
}

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

/** Approved saved copy; figures only from the stored saved snapshot, all-or-nothing (never recomputed or defaulted). */
export function SavedSpotPanel({ response, savedChoice }: { response: SavedResponse | null; savedChoice?: string | null }) {
  const area = num(response?.saved_area_m2), total = num(response?.saved_total), discount = num(response?.saved_veu_discount);
  const figures = area && total != null && discount != null ? { area, total, discount } : null;
  return <div className="rounded-xl border border-estimate-green bg-estimate-mint p-4 text-center" data-testid="spot-saved">
    <h2 className="inline-flex items-center gap-2 font-display text-xl font-extrabold text-estimate-navy"><CheckCircle2 aria-hidden="true" className="size-5 text-estimate-green" />{SPOT_SAVED_HEADING}</h2>
    <p className="mt-2 text-sm text-estimate-navy">{SPOT_SAVED_BODY}</p>
    {figures && <p className="mt-2 text-sm font-semibold text-estimate-navy">Saved estimate: {money(figures.total)} after an estimated {money(figures.discount)} rebate ({Math.round(figures.area)} m²).</p>}
    {savedChoice && <p className="mt-2 text-xs text-estimate-navy/75">Saved with the {savedChoice} estimate.</p>}
  </div>;
}
