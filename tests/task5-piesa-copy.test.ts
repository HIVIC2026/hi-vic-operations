import { expect,test } from 'bun:test';
import { piesaDeliveryPlan } from '../src/lib/piesa-delivery.core';
test('completed signed PIESA copy can reach owner before installation booking',()=>{
 const p=piesaDeliveryPlan({signedCopyId:'copy',piesaRecordId:'record',installStart:null,delivered:{owner:false,installer:false},email:{owner:'owner@example.invalid',installer:'office@example.invalid'},closed:false});
 expect(p.send).toEqual(['owner']); expect(p.hold).toBeNull();
});
test('recorded owner copy is never sent twice before booking',()=>{
 const p=piesaDeliveryPlan({signedCopyId:'copy',piesaRecordId:'record',installStart:null,delivered:{owner:true,installer:false},email:{owner:'owner@example.invalid',installer:'office@example.invalid'},closed:false}); expect(p.send).toEqual([]);
});