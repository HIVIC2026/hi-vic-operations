import {canonicalMittiTemplateId} from './mitti-identity.core';
export const INSTALL_BEFORE_AREAS_LABEL = 'Areas needing BEFORE photos today';
/** Staged alternate capture is OFF unless explicitly configured; normal A5 remains readable. */
export function selectInstallTemplate(normal:string,alternate:string|null,enabled:boolean,neededAreas:string[]) {
 if(!enabled||!neededAreas.length)return {templateId:normal,before:false,areas:''};
 const id=canonicalMittiTemplateId(alternate??'');
 if(!id)throw new Error('A5 + BEFORE photos is not configured — office review required.');
 return {templateId:alternate??id,before:true,areas:neededAreas.join(' · ')};
}