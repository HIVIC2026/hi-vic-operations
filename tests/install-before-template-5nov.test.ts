import {expect,test} from 'bun:test';
import {selectInstallTemplate} from '../src/lib/install-before-template.core';
const normal='11111111-1111-4111-8111-111111111111',alt='22222222-2222-4222-8222-222222222222';
test('alternate path is switchable and remains off without activation',()=>expect(selectInstallTemplate(normal,null,false,['Kitchen']).templateId).toBe(normal));
test('accepted areas use normal A5 even with alternate active',()=>expect(selectInstallTemplate(normal,alt,true,[]).templateId).toBe(normal));
test('missing alternate id refuses needed capture instead of silently skipping',()=>expect(()=>selectInstallTemplate(normal,null,true,['Kitchen'])).toThrow('not configured'));
test('alternate preserves exact needed area names',()=>expect(selectInstallTemplate(normal,alt,true,['Kitchen','Bedroom'])).toEqual({templateId:alt,before:true,areas:'Kitchen · Bedroom'}));