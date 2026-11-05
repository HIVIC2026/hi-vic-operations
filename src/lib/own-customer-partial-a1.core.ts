// Quote preparation only; never proves Ready Check completion or installation evidence.
import type { MittiArea } from './mitti.core';
import { canonicalMittiLabel } from './mitti-rebuild-labels.core';
import { excludedAreaName } from './excluded-areas.core';
import { LEAN_Q } from './ready-check-lean.core';

export function partialA1QuoteCore(input: {
  areaM2: number | null;
  areas: Pick<MittiArea, 'label' | 'areaM2' | 'measurementMethod' | 'removal' | 'removalM2' | 'existing'>[];
  entries: { label: string; value: unknown }[];
}) {
  const missing: string[] = [];
  const active = input.areas.filter(a => a && !excludedAreaName(a.label ?? ''));
  const values = (labels: string[]) => input.entries.filter(e => labels.includes(canonicalMittiLabel(e.label).split('\n')[0]?.trim() ?? '')).map(e => String(e.value ?? '').trim()).filter(Boolean);
  if (active.length) {
    for (const a of active) {
      if (!(a.areaM2 != null && Number.isFinite(a.areaM2) && a.areaM2 > 0)) missing.push(`${a.label}: install m²`);
      if (!a.measurementMethod?.trim()) missing.push(`${a.label}: how measured`);
      if (a.existing !== 'none' && a.removal !== 'no' && !(a.removalM2 != null && Number.isFinite(a.removalM2) && a.removalM2 >= 0)) missing.push(`${a.label}: removal m² or none`);
    }
  } else {
    if (!(input.areaM2 != null && Number.isFinite(input.areaM2) && input.areaM2 > 0)) missing.push('install m²');
    if (!values([LEAN_Q.measuredHow, 'How was the ceiling measured?', 'Measurement method', 'How the ceiling was measured']).length) missing.push('how measured');
    const removal = values([LEAN_Q.removeM2, 'Removal m²', 'Area to remove (m2)']);
    const noRemoval = values([LEAN_Q.existing, LEAN_Q.existingAction, 'Removal required?', 'Removal required']).some(v => /^(no|none|keep|leave|leave in place)$/i.test(v));
    if (!noRemoval && !removal.some(v => /^(none|no)$/i.test(v) || (/^\d+(?:\.\d+)?$/.test(v) && Number(v) >= 0))) missing.push('removal m² or none');
  }
  const informational = input.entries.filter(e => e.value == null || String(e.value).trim() === '').map(e => e.label.split('\n')[0]?.trim() ?? '').filter(Boolean);
  return { ready: missing.length === 0, missing, information: [...new Set(informational)].slice(0, 8) };
}