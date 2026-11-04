import { expect, test } from 'bun:test';
import { parseAudit, contactAnswersFromEntries } from '../src/lib/mitti.core';
import { shortAnswersFromEntries } from '../src/lib/official-short.core';
import { expandPiesa } from '../src/lib/official-expand.core';
import { readFixesDay, isFixesDayDoc } from '../src/lib/fixes-day.core';
import { readInstallDay, isInstallDayDoc, INSTALL_DAY_Q, installDayOfficialAnswers } from '../src/lib/install-day.core';
import { readInstallEvidence } from '../src/lib/install-evidence.core';
import { validateTemplate, FORMS } from '../src/lib/mitti-forms.core';
import { canonicalMittiLabel, INSTALL_REBUILD_ALIASES } from '../src/lib/mitti-rebuild-labels.core';
import { layoutProductReady } from '../src/lib/ready-check-basics.core';
const e = (label: string, value: string) => ({ label, value });
const switchQ = 'Does the main switch work, can you reach it, does it switch off every cable in the ceiling, and can it be locked off?';
const rcdQ = 'Are safety switches (RCDs) fitted for the ceiling circuits, and have you tested them?';
const mainsQ = 'Have you found and marked the mains cable in the ceiling?';
const deadQ = 'With the main switch off, have you tested that the ceiling is dead?';
const expand = (entries: { label: string; value: string }[]) => expandPiesa(shortAnswersFromEntries('piesa', entries), { lifeSupportDeclared: 'no', today: '2026-11-04' });
test('new shortened solar Yes does not invent instructions or an accessible isolator', () => {
 const { answers, flagged } = expand([e('Is there solar, a battery or a generator at the house?', 'Yes'), e('Can it be shut down safely, and are its ceiling cables labelled, in conduit and protected?', 'Yes')]);
 expect(answers['p3.instructions']).toBeUndefined(); expect(answers['p3.isolator']).toBeUndefined(); expect(flagged.some(x => x.includes('Solar'))).toBe(true);
});
test('new A5 coverage wording cannot prove implemented controls or accessible isolator', () => {
 const { answers } = installDayOfficialAnswers({ items: [e('Does the safety plan cover every hazard at this house?', 'Yes'), e('Does its isolator (at ground level) work and switch off safely?', 'Yes')] });
 expect(answers['p3.table1']).toBeUndefined(); expect(answers['p4.isolator']).toBeUndefined();
});
test('explicit corrected wording supplies the missing safety facts', () => {
 const a3 = expand([e('Is there solar, a battery or a generator at the house?', 'Yes'), e('Do you have its shutdown and restart instructions, is its ground-level AC/DC isolator accessible and working, and are its ceiling cables labelled, in conduit, protected and supported?', 'Yes')]);
 expect(a3.answers['p3.instructions']).toBe('Yes'); expect(a3.answers['p3.isolator']).toBe('Yes');
 const a5 = installDayOfficialAnswers({items: [e('Have the hazards been considered and their controls implemented for this job?', 'Yes'), e('Is its ground-level isolator accessible, working and able to switch off safely?', 'Yes')]});
 expect(a5.answers['p3.table1']).toBe('Yes'); expect(a5.answers['p4.isolator']).toBe('Yes');
});
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
test('unknown switch defects do not populate safe official items', () => {
 const { answers, flagged } = expand([e(switchQ, 'No'), e("Tick everything that's not right.", 'The main switch cannot be secured in the off position. | Unknown defect'), e(rcdQ, 'Yes'), e(mainsQ, 'Yes'), e(deadQ, 'Yes')]);
 expect(answers['p2.switchAccessible']).toBeUndefined(); expect(flagged.some(x => x.includes('not recognised'))).toBe(true);
});
test('duplicate split answers are ambiguous, not last-answer-wins', () => {
 const { answers, flagged } = expand([e(switchQ, 'No'), e(switchQ, 'Yes'), e(rcdQ, 'Yes'), e(mainsQ, 'Yes'), e(deadQ, 'Yes')]);
 expect(answers['p2.switchAccessible']).toBeUndefined(); expect(flagged.some(x => x.includes('Main switch'))).toBe(true);
});
test('A3 template accepts split questions but refuses a missing tested-dead field', () => {
 const fields = FORMS.piesa.fields.filter(f => !f.statement && f.id !== 'mainsSafe' && f.id !== 'mainsProblems');
 const items = fields.map(f => ({ label: f.label, type: f.type === 'tick' ? 'checkbox' : f.type === 'multichoice' ? 'list' : f.type }));
 items.push(...[switchQ, rcdQ, mainsQ, deadQ].map(label => ({ label, type: 'yesno' })));
 expect(validateTemplate('piesa', items).ok).toBe(true);
 expect(validateTemplate('piesa', items.filter(i => i.label !== deadQ)).ok).toBe(false);
});
test('layout product readiness needs a real approved brand and batt, never a brand alone', () => {
 const entries = [e('Old insulation in this area?', 'None'), e('Which brand are you installing?', 'Earthwool')];
 expect(layoutProductReady(entries, null)).toBe(false);
 expect(layoutProductReady([...entries, e('Which batts?', 'R7.0')], null)).toBe(false);
 expect(layoutProductReady([...entries, e('Which batts?', 'R5.0')], null)).toBe(true);
 expect(layoutProductReady(entries, [{ brand: 'Bradford Gold', r: 3.5 }])).toBe(true);
});
test('A5 aliases preserve two separately timed signatures and private media metadata', () => {
 const doc = { items: [
 { id: 'start', label: "Lead installer's signature", responses: { media_id: '11111111-1111-1111-1111-111111111111', name: 'TEST Lead', signed_at: '2026-11-04T00:00:00Z' } },
 { id: 'video', label: INSTALL_REBUILD_ALIASES[INSTALL_DAY_Q.afterVideos], media: [{ id: 'after-test', captured_at: '2026-11-04T01:00:00Z', lat: -37, lng: 145 }] },
 { id: 'end', label: "Lead installer's signature", responses: { media_id: '22222222-2222-2222-2222-222222222222', name: 'TEST Lead', signed_at: '2026-11-04T02:00:00Z' } },
 ] };
 const r = readInstallDay(doc);
 expect(r.declarationSignature.signedAt).toBe('2026-11-04T00:00:00Z'); expect(r.completionSignature.signedAt).toBe('2026-11-04T02:00:00Z'); expect(r.media(INSTALL_DAY_Q.afterVideos)[0]?.lat).toBe(-37);
 expect(canonicalMittiLabel('Photo of the whole area, lights on')).toBe('Photo of the whole area, lights on');
});
// Jo 4 Nov 01:20 UTC wording tidy-up: new labels read as the old ones; old labels stay readable.
import { canonicalMittiLabel as canon20 } from '../src/lib/mitti-rebuild-labels.core';
import { readLayoutArea as layout20 } from '../src/lib/ceiling-layout.core';
import { areasFromReadyCheckEntries as diagram20 } from '../src/lib/area-diagram.core';
test('01:20 tidy-up labels map to the existing removal, condition and kept-reason questions', () => {
 expect(canon20('How much old insulation is coming out? (m²)')).toBe('How much existing insulation needs to be removed? (m²)');
 expect(canon20('Is the old insulation in good enough condition to lay new batts on top?')).toBe('Is the existing insulation in good enough condition to lay new insulation over?');
 expect(canon20('Why is the old insulation staying?')).toBe('Why is the existing insulation being kept?');
 expect(canon20('How much existing insulation needs to be removed? (m²)')).toBe('How much existing insulation needs to be removed? (m²)');
});
test('01:20 new removal label feeds the quote removal m² and the diagram', () => {
 const e=[{label:'Name this area',value:'Main house'},{label:'Area (m²)',value:'100'},{label:'Old insulation in this area?',value:'Yes, taking it out'},{label:'Old insulation R value?',value:'Under R2.0'},{label:'How much old insulation is coming out? (m²)',value:'30'}];
 expect(layout20(e).removeM2).toBe(30);
 expect(diagram20(e)[0]?.removeM2).toBe(30);
});
