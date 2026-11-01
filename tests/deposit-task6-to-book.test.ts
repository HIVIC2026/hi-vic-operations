import {expect,test} from 'bun:test';
import {installerNext, type InstallerHomeJob} from '../src/lib/installer-home.core';
const job:InstallerHomeJob={jobId:'j',jobNumber:'HV-1',street:'Practice',suburb:'Melbourne',channel:'hivic_sourced',stage:'installation_scheduling',place:'needs_me',placeTitle:'Book the install',nextAction:null,quoteLine:null,status:null,upcoming:null,installDeadline:'2026-11-30',endedAt:null,inHouseDispatch:'in_house'};
test('in-house install waits outside To book until confirmed deposit',()=>{
 expect(installerNext({...job,installDepositPaid:false}).group).toBe('progress');
 expect(installerNext({...job,installDepositPaid:null}).group).toBe('progress');
});
test('paid in-house install enters To book, one group only',()=>{
 expect(installerNext({...job,installDepositPaid:true}).group).toBe('action');
});
test('non-in-house classification stays unchanged',()=>{
 expect(installerNext({...job,inHouseDispatch:null,installDepositPaid:false}).group).toBe('action');
});