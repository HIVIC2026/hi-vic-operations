import { describe, expect, test } from 'bun:test';
import { parseAudit } from '../src/lib/mitti.core';
import { checkReadyCheckContradiction } from '../experiments/ready-check-contradiction/validator';

// Synthetic values in the same flat parent_id / selected-response shape used by
// tests/lean-ready-check.test.ts. Every case goes through the REAL pure parser.
const R = 'What is the determined R value of the existing ceiling insulation?';
const OUTCOME = 'Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?';
type Area = { name: string; r?: string; present?: string; inactive?: boolean; inactiveR?: boolean };
function sample(areas: Area[], outcome: string | null = 'Yes - Ready Check passed') {
  const question = (id: string, label: string, value: string | undefined, parent: string | null = null) => ({
    item_id: id, label, parent_id: parent,
    responses: value === undefined ? {} : { selected: [{ label: value }] },
  });
  return {
    audit_id: 'sample-only', template_id: 'sample-ready-check',
    items: [
      ...areas.flatMap((a, i) => {
        const parent = `area-${i}`;
        return [{ item_id: parent, type: 'dynamicfield', label: '', inactive: a.inactive },
          { ...question(`${parent}-name`, 'Which part of the home does this ceiling area cover?', a.name, parent), inactive: a.inactive },
          { ...question(`${parent}-existing`, 'Is there existing insulation in this ceiling area?', a.present ?? 'Yes', parent), inactive: a.inactive },
          { ...question(`${parent}-r`, R, a.r, parent), inactive: a.inactive || a.inactiveR }];
      }),
      question('outcome', OUTCOME, outcome ?? undefined),
    ],
  };
}
const check = (areas: Area[], outcome?: string | null, freshness: 'current' | 'stale' | 'unsynced' | 'unknown' = 'current') =>
  checkReadyCheckContradiction(parseAudit(sample(areas, outcome)), freshness);

describe('sample-only Ready Check contradiction spike', () => {
  test('Above R2.0 and passed gives an area-specific correction, not a claim about equality', () => {
    const result = check([{ name: 'Main house', r: 'Above R2.0' }]);
    expect(result.status).toBe('correction_needed');
    expect(result.corrections.map(x => x.area)).toEqual(['Main house']);
    expect(result.corrections[0]?.reason).toBe('disqualifying_band');
    expect(result.corrections[0]?.message).toContain('Main house');
  });
  test('checks the SECOND area, not the whole-job minimum R', () => {
    const result = check([{ name: 'Main house', r: '1.5' }, { name: 'Rear extension', r: '2.0' }]);
    expect(result.corrections.map(x => x.area)).toEqual(['Rear extension']);
    expect(result.corrections[0]?.reason).toBe('numeric_at_or_above_2');
  });
  test('reports every contradicting area', () => {
    expect(check([{ name: 'Main house', r: 'Above R2.0' }, { name: 'Rear extension', r: 'R3.0' }]).corrections).toHaveLength(2);
  });
  test('numeric EXACTLY 2 is disqualifying', () => {
    expect(check([{ name: 'Main house', r: '2' }]).status).toBe('correction_needed');
  });
  test('below band and numeric below 2 have no contradiction (not operational clearance)', () => {
    expect(check([{ name: 'Main house', r: 'Below R2.0' }, { name: 'Rear extension', r: '1.99' }]).status).toBe('no_contradiction');
  });
  test('already-failed outcome does not ask to correct a contradictory pass', () => {
    const result = check([{ name: 'Main house', r: 'Above R2.0' }], 'No - Ready Check failed');
    expect(result.status).toBe('already_failed');
    expect(result.corrections).toEqual([]);
  });
  for (const r of [undefined, 'Unknown', 'not measured', '-1']) {
    test(`existing insulation with ${String(r)} is unable to verify`, () => {
      const result = check([{ name: 'Rear extension', ...(r === undefined ? {} : { r }) }]);
      expect(result.status).toBe('unable_to_verify');
      expect(result.unknownAreas).toEqual(['Rear extension']);
    });
  }
  test('no insulation ignores stale hidden high R', () => {
    expect(check([{ name: 'Main house', present: 'No', r: '3.0' }]).status).toBe('no_contradiction');
  });
  test('inactive repeated responses are ignored by the real parser', () => {
    expect(check([{ name: 'Main house', r: 'Below R2.0' }, { name: 'Rear extension', r: '3.0', inactive: true }]).status).toBe('no_contradiction');
  });
  test('nested repeat and conditional children retain second-area identity; inactive parent hides descendants', () => {
    const audit = sample([{ name: 'Main house', r: 'Below R2.0' }, { name: 'Rear extension', r: '3.0' }]);
    const nested = {
      ...audit,
      items: [0, 1].map(i => ({
        item_id: `area-${i}`, label: '', type: 'dynamicfield',
        children: audit.items.filter(x => 'parent_id' in x && x.parent_id === `area-${i}`),
      })).concat([]),
    };
    const result = checkReadyCheckContradiction(parseAudit({ ...nested, items: [...nested.items, audit.items.at(-1)] }), 'current');
    expect(result.corrections.map(x => x.area)).toEqual(['Rear extension']);
    const hidden = { ...nested, items: nested.items.map((x, i) => ({ ...x, inactive: i === 1 })) };
    expect(checkReadyCheckContradiction(parseAudit({ ...hidden, items: [...hidden.items, audit.items.at(-1)] }), 'current').status).toBe('no_contradiction');
  });
  test('inactive R cannot verify present insulation', () => {
    expect(check([{ name: 'Main house', r: 'Below R2.0', inactiveR: true }]).status).toBe('unable_to_verify');
  });
  for (const freshness of ['stale', 'unsynced', 'unknown'] as const) {
    test(`${freshness} answers never appear cleared`, () => {
      expect(check([{ name: 'Main house', r: 'Below R2.0' }], undefined, freshness).status).toBe('unable_to_verify');
    });
  }
  test('missing or unknown outcome is unable to verify', () => {
    for (const outcome of [null, 'Maybe']) expect(check([{ name: 'Main house', r: 'Below R2.0' }], outcome).status).toBe('unable_to_verify');
  });
  test('no active areas is unable to verify', () => {
    expect(check([]).status).toBe('unable_to_verify');
  });
  test('missing insulation answer is unable to verify', () => {
    expect(check([{ name: 'Main house', present: '', r: 'Below R2.0' }]).status).toBe('unable_to_verify');
  });
  test('known contradiction is retained even alongside an unknown area', () => {
    const result = check([{ name: 'Main house', r: '3.0' }, { name: 'Rear extension' }]);
    expect(result.status).toBe('correction_needed');
    expect(result.unknownAreas).toEqual(['Rear extension']);
  });
  test('stale high R retains correction plus unable-to-verify freshness', () => {
    const result = check([{ name: 'Main house', r: 'Above R2.0' }], undefined, 'stale');
    expect(result.corrections).toHaveLength(1);
    expect(result.freshness).toBe('stale');
    expect(result.notes.some(x => x.includes('Unable to verify'))).toBe(true);
  });
  test('does not mutate parsed answers or mark partial inspection complete', () => {
    const parsed = parseAudit(sample([{ name: 'Main house', r: 'Above R2.0' }]));
    const before = JSON.stringify(parsed);
    checkReadyCheckContradiction(parsed, 'current');
    expect(JSON.stringify(parsed)).toBe(before);
    expect(parsed.completed).toBe(false);
  });
});