import { expect, test } from 'bun:test';
import * as policy from '../src/lib/in-house-message.core';
import { needsCandidates } from '../src/lib/office-needs.core';
// Rules about who coordinates visits, not copy/markup snapshots.
for (const stage of ['ready_check_ready_to_schedule','piesa_and_install_window_pending','rectification_scheduling','installation_scheduling']) {
 test(`${stage}: held owner cannot coordinate; normal/payee-only retain coordination`,()=>{
   expect(policy.ownerVisitCoordinationAllowed('in_house')).toBe(false);
   expect(policy.ownerVisitCoordinationAllowed('in_house_read_failed')).toBe(false);
   expect(policy.ownerVisitCoordinationAllowed(null)).toBe(true);
   expect(policy.inHouseVisitForStage(stage)).not.toBeNull();
 });
}
test('held state hides only legacy coordination Needs-me, not payment or compliance',()=>{
 const f={jobId:'j',jobNumber:'HV-9000',surname:'TEST',suburb:null,inHouseDispatch:'in_house' as const,bookingOverdue:{at:'2026-10-01',visit:'installation' as const},fixesTimesMissing:{at:'2026-10-01'},electricianToChoose:{at:'2026-10-01',usual:null},invoiceFailed:{at:'2026-10-01',text:'payment failed'},piesaOwnerUnsigned:{at:'2026-10-01',completedDate:null}};
 const kinds=needsCandidates(f,Date.parse('2026-10-30')).map(c=>c.kind);
 expect(kinds).not.toContain('booking_overdue');expect(kinds).not.toContain('fixes_times_missing');expect(kinds).not.toContain('choose_electrician');expect(kinds).toContain('invoice_failed');expect(kinds).toContain('piesa_owner_unsigned');
 expect(needsCandidates({...f,inHouseDispatch:null},Date.parse('2026-10-30')).map(c=>c.kind)).toContain('booking_overdue');
});
