import { expect, test } from 'bun:test';
import { certificateExpiryWarning, effectiveCertificateExpiry } from '../src/lib/team-certificate-expiry.core';
import { allocationBlocker } from '../src/lib/visit-allocation.core';
import { staffFromRecords } from '../src/lib/piisa-a3.core';
import { teamRow } from '../src/lib/team-screen.core';
const today = '2026-11-05';
for (const expiresOn of ['2026-11-04', '2026-12-05']) {
  test(`${expiresOn}: Team warning and install allocation only`, () => {
    const clearance = { certStatus:'verified', level:'full', expiresOn };
    const person = { workerId:'test', name:'TEST Lead', tradeRole:'installer', workerRole:'lead' as const, email:null, mobile:'0412345678', clearance };
    expect(certificateExpiryWarning(expiresOn, today)).not.toBeNull();
    expect(allocationBlocker('install', person, today)).not.toBeNull();
    expect(allocationBlocker('ready_check', person, today)).toBeNull();
    expect(teamRow({name:person.name, role:'installer', workerRole:'lead', mobile:person.mobile, cii:clearance, escRegistered:true, licenceAndRec:false, canSeeMoney:false, hasDob:true}, today).warn).toBe(true);
  });
}
test('31 days remaining does not add an allocation block', () => {
  expect(certificateExpiryWarning('2026-12-06', today)).toBeNull();
});
test('declared expiry never extends verified expiry and cannot create verification', () => {
  expect(effectiveCertificateExpiry('2026-11-04','2027-11-05')).toBe('2026-11-04');
  const [person] = staffFromRecords([{id:'test',full_legal_name:'TEST Crew',approval_status:'pending',removed_at:null,trade_role:'installer',worker_role:'crew',certification:{eec_upload:{number:'CII',expires_on:'2026-11-04'}}}],[],[],undefined,today);
  expect(person?.expiresOn).toBe('2026-11-04');
  expect(person?.eecVerified).toBe(false);
  expect(person?.cleared).toBe(false);
});