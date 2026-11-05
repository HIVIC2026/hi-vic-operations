import { describe, expect, test } from 'bun:test';
import { rulerPhotoEvaluation, type JobZone } from '../src/lib/install-evidence.core';
import type { MittiMediaFile } from '../src/lib/piesa-evidence.core';

const photo: MittiMediaFile = {mediaId:'after',lat:-37.8,lng:145,capturedAt:'2026-11-05T02:00:00Z',sizeBytes:100};
const zones: JobZone[] = [{name:'Kitchen',underInsulated:true,existingDepthAccepted:true}];
describe('Jo 4 Nov accepted Ready Check ruler reuse',()=>{
 test('published A5 after ruler completes without a duplicate old-insulation ruler',()=>{
  expect(rulerPhotoEvaluation({onForm:true,areas:[{existing:[],after:[photo]}]},zones).blockers).toEqual([]);
 });
 test('missing accepted Ready Check ruler remains area-specific and blocked',()=>{
  expect(rulerPhotoEvaluation({onForm:true,areas:[{existing:[],after:[photo]}]},[{name:'Kitchen',underInsulated:true,existingDepthAccepted:false}]).blockers).toContain('Kitchen: existing insulation depth photo with a ruler is missing');
 });
 test('accepted first area never clears missing second-area evidence',()=>{
  const r=rulerPhotoEvaluation({onForm:true,areas:[{existing:[],after:[photo]},{existing:[],after:[photo]}]},[...zones,{name:'Bedroom',underInsulated:true,existingDepthAccepted:false}]);
  expect(r.blockers).toEqual(['Bedroom: existing insulation depth photo with a ruler is missing']);
 });
 test('accepted BEFORE never removes required AFTER ruler',()=>{
  expect(rulerPhotoEvaluation({onForm:true,areas:[{existing:[],after:[]}]},zones).blockers).toContain('Kitchen: new insulation depth photo with a ruler is missing');
 });
 test('normal A5 multi-file depth also requires accepted old-depth evidence',()=>{
  expect(rulerPhotoEvaluation(undefined,zones,null,{onForm:true,files:[photo]}).blockers).toEqual([]);
  expect(rulerPhotoEvaluation(undefined,[{name:'Kitchen',underInsulated:true}],null,{onForm:true,files:[photo]}).blockers).toContain('Kitchen: existing insulation depth photo with a ruler is missing');
 });
});