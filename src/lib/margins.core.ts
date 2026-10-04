// Office-only "Margins" view maths. Pure: labels each approved trade's agreed rates against current owner prices.
// Installer rate cards are stored ex GST; electrician rates inc GST. Everything is compared inc GST.
const r2 = (n: number) => Math.round(n * 100) / 100;

export type OwnerPrices = { r5PerM2: number; removalPerM2: number; piesa: number; apFee: number; gstRate: number };
export type MarginLine = { item: string; ownerInc: number; rateInc: number | null; markupInc: number | null; negative: boolean; missing: boolean };

export function installerMargins(p: OwnerPrices, r5ExPerM2: number | null, removalExPerM2: number | null): MarginLine[] {
  return [
    line("Installation per m²", p.r5PerM2, r5ExPerM2 == null ? null : r5ExPerM2 * (1 + p.gstRate)),
    line("Removal per m²", p.removalPerM2, removalExPerM2 == null ? null : removalExPerM2 * (1 + p.gstRate)),
  ];
}

export function electricianMargins(p: OwnerPrices, piesaRateInc: number | null): MarginLine[] {
  return [line("PIESA", p.piesa, piesaRateInc)];
}

function line(item: string, ownerInc: number, rateInc: number | null): MarginLine {
  if (rateInc == null) return { item, ownerInc, rateInc: null, markupInc: null, negative: false, missing: true };
  const m = r2(ownerInc - rateInc);
  return { item, ownerInc, rateInc: r2(rateInc), markupInc: m, negative: m < 0, missing: false };
}
