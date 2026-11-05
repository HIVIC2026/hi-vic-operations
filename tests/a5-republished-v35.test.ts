import { expect, test } from 'bun:test';
import definition from './fixtures/a5-before-v35.json';
import { installDayBeforePhotos } from '../src/lib/install-day.core';
import { beforePhotoEvaluation } from '../src/lib/install-evidence.core';

const labels = ['Name this area','BEFORE video: slow 360° turn of this area','Is there existing insulation in this ceiling area?','What type is the old insulation? Tick all that apply.','What is the determined R value of the existing ceiling insulation?','Depth of the old insulation (mm)','Photo: ruler standing straight up in the old insulation','Is the old insulation foil-backed or metal (anything that could carry electricity)?',"Close-up photo of the old insulation's backing",'What is required for the existing insulation?','How much old insulation is coming out? (m²)','Is the old insulation in good enough condition to lay new batts on top?','Why is the old insulation staying?'];
const field = (label:string, value:unknown) => ({label,responses:{text:value}});
const media = (label:string, video=false) => ({label,media:[{id:label,mime_type:video?'video/mp4':'image/jpeg',captured_at:'2026-11-05T09:00:00Z',...(video?{}:{latitude:-37,longitude:145})}]});
const area = (name:string, treatment='Top up') => ({id:name,label:'Ceiling area – before',children:[field(labels[0]??'',name),media(labels[1]??'',true),field(labels[2]??'','Yes'),{label:labels[3],responses:{selected:[{label:'Batts'},{label:'Loose fill'},{label:'Other'}]}},field(labels[4]??'','Below R2.0'),field(labels[5]??'',60),media(labels[6]??''),field(labels[7]??'','No'),media(labels[8]??''),field(labels[9]??'',treatment),field(labels[10]??'',12),field(labels[11]??'','Yes'),field(labels[12]??'','Good condition')]});
test('BEFORE videos without GPS do not block',()=>{const read=installDayBeforePhotos({items:[area('Main'),area('Garage','Remove')]});expect(beforePhotoEvaluation(read,[]).blockers).toEqual([]);});
test('multi-select retains all three live old-insulation options separately per area',()=>{const read=installDayBeforePhotos({items:[area('Main'),area('Garage')]});expect(read.areas.map(a=>[a.name,a.oldType])).toEqual([['Main','Batts, Loose fill, Other'],['Garage','Batts, Loose fill, Other']]);});
test('v35 definition blank media objects remain readable without crashing',()=>{const read=installDayBeforePhotos(definition);expect(read.onForm).toBe(true);expect(beforePhotoEvaluation(read,[]).blockers.length).toBeGreaterThan(0);});
test('other pages cannot supply missing BEFORE answers',()=>{const a=area('Main');a.children=a.children.filter(f=>f.label!==labels[5]);const read=installDayBeforePhotos({items:[{label:'Before you start',children:[a]},{label:'After',children:[field(labels[5]??'',90)]}]});expect(read.areas[0]?.depthMm).toBeNull();});
test('old A5 without BEFORE stays readable',()=>{expect(beforePhotoEvaluation(installDayBeforePhotos({items:[{label:'Install day',children:[]}]}),[]).blockers).toEqual([]);});
test('blank in-progress BEFORE never manufactures completion',()=>{expect(beforePhotoEvaluation(installDayBeforePhotos({items:[{label:'Before you start',children:[{id:'a',label:'Ceiling area – before',children:[field(labels[0]??'','Main')]}]}]}),[]).blockers.length).toBeGreaterThan(0);});
test('Not sure is an answered treatment, not missing Remove or Top up follow-ups',()=>{const a=area('Main','Not sure');a.children=a.children.filter(f=>![labels[10],labels[11],labels[12]].includes(f.label));expect(beforePhotoEvaluation(installDayBeforePhotos({items:[a]}),[]).blockers).toEqual([]);});
test('live v35 nested definition reads answers independently of other pages',()=>{
 const audit=structuredClone(definition) as unknown as {template:{items:Record<string,unknown>[]}};
 const source=area('Main').children;
 const walk=(items:Record<string,unknown>[])=>{for(const item of items){const answer=source.find(f=>f.label===item['label']);if(answer)Object.assign(item,answer);if(Array.isArray(item['children']))walk(item['children'] as Record<string,unknown>[]);}};
 walk(audit.template.items);
 audit.template.items.push({label:'After',children:[field(labels[0]??'','Wrong area'),field(labels[5]??'',999)]});
 const read=installDayBeforePhotos(audit);
 expect(read.areas).toHaveLength(1);
 expect(read.areas[0]).toMatchObject({name:'Main',depthMm:60,removal:'no',oldType:'Batts, Loose fill, Other'});
 expect(beforePhotoEvaluation(read,[]).blockers).toEqual([]);
});