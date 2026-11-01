import {expect,test} from 'bun:test';
import {registryChange,REGISTRY_FIELDS_VERSION,registryUpdateTimingReasons} from '../src/lib/esc.core';
import {planNotification,type NoticeCandidate} from '../src/lib/esc-registry-robot.core';
const start='2026-11-03T21:00:00Z',now=new Date('2026-11-03T20:00:00Z');
const payload=(name:string)=>({fields_version:REGISTRY_FIELDS_VERSION,additional:{lead_installer:name}});
const previous={id:'old',scheduled_start:start,sent_at:'2026-11-01T21:00:00Z',submission_reference:'VEU-123',payload_json:payload('Old Lead')};
test('same-start Lead Installer update allowed one hour before start, never at/past start',()=>{
 expect(registryUpdateTimingReasons(start,start,now.toISOString())).toEqual([]);
 expect(registryUpdateTimingReasons(start,start,start)).toContain('The original installation date and time has passed.');
 expect(registryChange(previous,{scheduled_start:start,payload_json:payload('New Lead')},now.toISOString()).action).toBe('update_same_id');
});
test('robot uses update_same_id before start despite closed initial-submission window',()=>{
 const c:NoticeCandidate={jobId:'j',jobSource:'qa_test',notificationId:'new',version:2,status:'ready',scheduledStart:start,sentAt:null,submissionReference:null,consentId:'consent',missing:[],payloadJson:payload('New Lead'),previousSent:previous,robotEvents:[]};
 expect(planNotification(c,now)).toMatchObject({action:'update_same_id',reference:'VEU-123'});
 expect(planNotification({...c,previousSent:null},now).action).toBe('skip');
});