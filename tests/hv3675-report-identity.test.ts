import { expect, test } from 'bun:test';
import { MITTI_TEMPLATE_ID, validateStoredMittiAudit } from '../src/lib/mitti.core';
const context = { storedAuditId:'sim_audit_hv3675', jobNumber:'HV-3675', templateId:MITTI_TEMPLATE_ID };
const audit = (duplicate:string) => ({audit_id:context.storedAuditId,template_id:MITTI_TEMPLATE_ID,header_items:[{item_id:'new',label:'Job number',responses:{text:'HV-3675'}}],items:[{item_id:'old',label:'Portal Job Number',responses:{text:duplicate}}]});
test('HV-3675 matching new label and blank legacy copy do not prevent report processing',()=>{
  expect(()=>validateStoredMittiAudit(audit(''),context)).not.toThrow();
});
test('a conflicting filled legacy number still blocks wrong-job report processing',()=>{
  expect(()=>validateStoredMittiAudit(audit('HV-OTHER'),context)).toThrow();
});