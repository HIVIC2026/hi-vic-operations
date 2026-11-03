import { expect, test } from 'bun:test';
import { parseAudit, contactAnswersFromEntries } from '../src/lib/mitti.core';
import { shortAnswersFromEntries } from '../src/lib/official-short.core';
import { expandPiesa } from '../src/lib/official-expand.core';
import { readFixesDay, isFixesDayDoc } from '../src/lib/fixes-day.core';
import { readInstallDay, isInstallDayDoc, INSTALL_DAY_Q } from '../src/lib/install-day.core';
import { readInstallEvidence } from '../src/lib/install-evidence.core';
const e = (label: string, value: string) => ({ label, value });
const switchQ = 'Does the main switch work, can you reach it, does it switch off every cable in the ceiling, and can it be locked off?';
const rcdQ = 'Are safety switches (RCDs) fitted for the ceiling circuits, and have you tested them?';
const mainsQ = 'Have you found and marked the mains cable in the ceiling?';
const deadQ = 'With the main switch off, have you tested that the ceiling is dead?';
const expand = (entries: { label: string; value: string }[]) => expandPiesa(shortAnswersFromEntries('piesa', entries), { lifeSupportDeclared: 'no', today: '2026-11-04' });
test('four mains answers populate seven independent official facts', () => {
  const { answers } = expand([e(switchQ, 'Yes'), e(rcdQ, 'Yes'), e(mainsQ, 'No'), e(deadQ, 'Yes')]);
  expect(answers['p2.mains']).toBe('No');
  for (const id of ['switchAccessible', 'switchIsolates', 'switchSecured', 'rcdPresent', 'rcdTested', 'tested']) expect(answers[`p2.${id}`]).toBe('Yes');
});
test('missing tested-dead answer stays blank even when all other mains answers are Yes', () => {
  const { answers, flagged } = expand([e(switchQ, 'Yes'), e(rcdQ, 'Yes'), e(mainsQ, 'Yes')]);
  expect(answers['p2.tested']).toBeUndefined(); expect(flagged.some(x => x.includes('tested'))).toBe(true);
});
test('reordered repeated problem lists stay with switch and RCD answers', () => {
  const { answers } = expand([e(rcdQ, 'No'), e("Tick everything that's not right.", 'The safety switches (RCDs) have not been tested.'), e(switchQ, 'No'), e("Tick everything that's not right.", 'The main switch cannot be secured in the off position.'), e(mainsQ, 'Yes'), e(deadQ, 'Yes')]);
  expect(answers['p2.rcdTested']).toBe('No'); expect(answers['p2.switchSecured']).toBe('No'); expect(answers['p2.switchAccessible']).toBe('Yes');
});
test('No switch answer without defect detail never fabricates three safe switch facts', () => {
  const { answers, flagged } = expand([e(switchQ, 'No'), e(rcdQ, 'Yes'), e(mainsQ, 'Yes'), e(deadQ, 'Yes')]);
  expect(answers['p2.switchAccessible']).toBeUndefined(); expect(answers['p2.switch']).toBe('No'); expect(flagged.some(x => x.includes('Main switch'))).toBe(true);
});
test('Ready Check renamed area fields keep measurements and permission', () => {
  const items = [e('Name this area', 'Rear extension'), e('Length (m)', '10'), e('Width (m)', '12'), e('Area (m²)', '120'), e('Old insulation in this area?', 'Yes, topping up'), e('Old insulation R value?', 'R1.5'), e('Depth of the old insulation (mm)', '75'), e('How did you measure this area?', 'Laser measure'), e('Is the old insulation foil-backed or metal (anything that could carry electricity)?', 'No')];
  const p = parseAudit({ items: [{ id: 'area', label: 'Add a ceiling area', children: items.map((x,i) => ({ id: `a${i}`, label: x.label, responses: { text: x.value } })) }] });
  expect(p.areas[0]?.name).toBe('Rear extension'); expect(p.areas[0]?.layout?.name).toBe('Rear extension'); expect(p.areas[0]?.areaM2).toBe(120); expect(p.areas[0]?.depthMm).toBe(75); expect(p.areas[0]?.conductive).toBe(false);
  expect(contactAnswersFromEntries([e('Did the homeowner say Home Insulation Victoria can contact them?', 'Yes')]).contactPermission).toBe(true);
});
test('A4 new completion and certificate wording reads without an old label', () => {
  const doc = { items: [e('The upgrade work listed on the safety check:', 'Install RCD'), e('Have you finished ALL the upgrade work listed above, and is the ceiling now safe for insulation?', 'Yes'), e('Date on the certificate', '2026-11-04')] };
  expect(isFixesDayDoc(doc)).toBe(true); expect(readFixesDay(doc).done).toBe('Yes'); expect(readFixesDay(doc).certDate).toBe('2026-11-04');
});
test('A5 new after-video and final tick identify the form and feed completion evidence', () => {
  const doc = { items: [e('Everything on this form is true and complete', 'Yes'), e('AFTER videos: one slow 360° turn of each area', '1 video'), e("Every answer, photo and video is filled in. I won't leave until the portal texts me 'All filled in'.", 'Yes'), e('Is the lock and tag off and the power back on?', 'Yes')] };
  expect(isInstallDayDoc(doc)).toBe(true); expect(readInstallDay(doc).ticked(INSTALL_DAY_Q.allFilledIn)).toBe(true); expect(readInstallEvidence(doc).after.allFilledIn).toBe(true); expect(readInstallEvidence(doc).after.lockoutRemoved).toBe(true);
});
test('A5 No final tick and inactive answers never count as completion', () => {
  const doc = { items: [e('Everything on this form is true and complete', 'Yes'), e('AFTER videos: one slow 360° turn of each area', '1 video'), e("Every answer, photo and video is filled in. I won't leave until the portal texts me 'All filled in'.", 'No'), { ...e('Is the lock and tag off and the power back on?', 'Yes'), inactive: true }] };
  expect(readInstallDay(doc).ticked(INSTALL_DAY_Q.allFilledIn)).toBe(false); expect(readInstallEvidence(doc).after.allFilledIn).toBe(false); expect(readInstallDay(doc).yn(INSTALL_DAY_Q.lockoutOff)).toBeNull();
});