import { expect, test } from 'bun:test';
import { parseAudit } from '../src/lib/mitti.core';
import { partialA1QuoteCore } from '../src/lib/own-customer-partial-a1.core';
import { applyMittiProduct, buildOwnCustomerQuoteDraft } from '../src/lib/mitti-installer-quote.core';
import { resolveMittiProduct } from '../src/lib/insulation-product.core';
const item = (label: string, text: string | null, parent_id: string | null = 'area') => ({ item_id: label, label, parent_id, responses: text == null ? {} : { text } });
function read(over: { method?: string | null; removal?: string | null; area?: string | null; completed?: boolean } = {}) {
  const p = parseAudit({ audit_id: 'sample-a1', completed: over.completed ?? false, items: [
    { item_id: 'area', label: '', type: 'dynamicfield' },
    item('Ceiling area name', 'Main house'), item('Length (m)', over.area === undefined ? '10' : over.area), item('Width (m)', '12'),
    item('How did you measure this area?', over.method === undefined ? 'Laser measure' : over.method),
    item('How much old insulation is coming out? (m²)', over.removal === undefined ? '0' : over.removal),
    item('How easy is the ceiling access?', null, null), item('Whole area photo', null),
  ] });
  return partialA1QuoteCore({ areaM2: p.patch.measured_area_m2 ?? null, areas: p.areas, entries: p.snapshot });
}
test('partial A1 with install m², zero removal and method can prepare a quote without Complete', () => {
  expect(read().ready).toBe(true);
});
test('missing non-core answers and media are information, not blockers', () => {
  expect(read().missing).toEqual([]);
  expect(read().information).toContain('How easy is the ceiling access?');
});
test('missing measurement method blocks quote submission', () => expect(read({ method: null }).ready).toBe(false));
test('missing removal is not silently treated as none', () => expect(read({ removal: null }).ready).toBe(false));
test('missing install m² blocks quote submission', () => expect(read({ area: null }).ready).toBe(false));
test('positive removal accepted and Complete makes no difference', () => {
  expect(read({ removal: '25' }).ready).toBe(true);
  expect(read({ completed: true }).ready).toBe(read().ready);
});
test('explicit none on a legacy form is accepted', () => {
  expect(partialA1QuoteCore({ areaM2: 120, areas: [], entries: [{ label: 'Measurement method', value: 'Tape' }, { label: 'Removal m²', value: 'none' }] }).ready).toBe(true);
});
test('every active area needs core details, including the second area', () => {
  const a = { label: 'Main house', areaM2: 120, measurementMethod: 'Laser', removal: 'no' as const, removalM2: null, existing: null };
  expect(partialA1QuoteCore({ areaM2: 140, areas: [a, { ...a, label: 'Extension', measurementMethod: null }], entries: [] }).missing).toEqual(['Extension: how measured']);
});
test('missing product does not hold a partial A1 draft; the existing fee and PIESA figures remain', () => {
  const draft = buildOwnCustomerQuoteDraft({ price: { ok: true, issues: [], price: { totalIncGst: 2500, included: ['Ceiling insulation - supply & install'], otherDescription: '', agreedWithOwner: false } }, measuredM2: 120, wholeVeec: { veecs: 10, raw: 600 }, caps: { metropolitan: true, minCopay: 200 } }, 275);
  applyMittiProduct(draft, resolveMittiProduct(null), 120, { optionalMissing: true });
  expect(draft.ready).toBe(true);
  expect(draft.subtotal).toBe(3124);
  expect(draft.blockers).toEqual([]);
});
test('legacy product rules are not loosened for A2 or non-submitted jobs', () => {
  const draft = { ready: true, blockers: [] as string[], lines: [] };
  applyMittiProduct(draft, resolveMittiProduct(null), 120);
  expect(draft.ready).toBe(false);
});