import {selectInstallTemplate} from './install-before-template.core';
/** No settings writes: the alternate stays inert until Jo supplies its validated template ID and activates it. */
export function configuredInstallTemplates(normal:string|null|undefined):string[] {
 const alternate=process.env['MITTI_INSTALL_BEFORE_TEMPLATE_ID']?.trim();
 return [normal,alternate].filter((id):id is string=>!!id?.trim());
}
export async function installTemplateForJob(jobId:string,normal:string) {
 const enabled=process.env['MITTI_INSTALL_BEFORE_ENABLED']==='true';
 if(!enabled)return selectInstallTemplate(normal,null,false,[]);
 const plan=await (await import('./install-before.server')).readInstallBeforePlan(jobId);
 if(plan.unknownAreas)throw new Error('BEFORE ceiling areas could not be checked — office review required.');
 return selectInstallTemplate(normal,process.env['MITTI_INSTALL_BEFORE_TEMPLATE_ID']??null,true,plan.needed.map(a=>a.name));
}