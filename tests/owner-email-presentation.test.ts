import { expect, test } from 'bun:test';
import { cleanOwnerEmail, isHumanOwnerEmail, latestPerOwner } from '../src/lib/owner-email-presentation.core';
test('strips HTML, signature, quoted reply and disclaimer without changing the reply', () => {
  expect(cleanOwnerEmail('<p>My ceiling photos are attached &amp; ready.</p><p>Kind regards</p><p>Sam</p><blockquote>Old quote</blockquote>')).toBe('My ceiling photos are attached & ready.');
  expect(cleanOwnerEmail('Can you call tomorrow?\n\nOn Friday, Jo wrote:\nOld reply')).toBe('Can you call tomorrow?');
  expect(cleanOwnerEmail('Please check the attached photos.\nThis email is confidential.')).toBe('Please check the attached photos.');
});
test('real owner reply to Spot saved remains visible; our automation never does', () => {
  expect(isHumanOwnerEmail({provider:'outlook',direction:'inbound',from:'sam@example.com',subject:'RE: Spot saved. Your rebate is waiting',body:'Can you call tomorrow?'})).toBe(true);
  expect(isHumanOwnerEmail({provider:'resend',direction:'outbound',body:'Spot saved'})).toBe(false);
  expect(isHumanOwnerEmail({provider:'outlook',direction:'inbound',from:'info@homeinsulationvictoria.com.au',body:'Spot saved'})).toBe(false);
});
test('auto replies, bounces and marketing are excluded', () => {
  for(const c of [{subject:'Automatic reply: Hello'}, {subject:'Undeliverable: quote'}, {body:'Buy now. Click to unsubscribe'}, {from:'no-reply@example.com'}]) expect(isHumanOwnerEmail({provider:'outlook',direction:'inbound',from:'sam@example.com',body:'Hello',...c})).toBe(false);
  expect(isHumanOwnerEmail({provider:'outlook',direction:'inbound',from:'sam@example.com',body:'Please unsubscribe me.'})).toBe(true);
});
test('two jobs for the same owner produce one latest owner row', () => {
  const r=latestPerOwner([{ownerId:'a',jobId:'HV-1',at:'2026-10-22'}, {ownerId:'a',jobId:'HV-2',at:'2026-10-23'}, {ownerId:'b',jobId:'HV-3',at:'2026-10-21'}]);
  expect(r.length).toBe(2);expect(r[0]?.jobId).toBe('HV-2');expect(r[0]?.jobIds).toEqual(['HV-2','HV-1']);
});