import {expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
import * as core from "../src/lib/mitti.core";

function fixture() {
 const writes:any[]=[];let completed=false;let wrong=false;
 const template=`template_${"a".repeat(32)}`;
 const audit=()=>({audit_id:"A5",template_id:wrong?`template_${"b".repeat(32)}`:template,completed,items:[{item_id:"job",label:"Portal Job Number",type:"text",responses:{text:"HV-TEST"}},{item_id:"date",label:"Install date",type:"datetime",responses:{datetime:"2026-11-16"}}]});
 const call:core.MittiCall=async(method,path,body)=>{if(method==="GET")return audit();writes.push({method,path,body});return {};};
 const admin={from(t:string){const q:any={select:()=>q,eq:()=>q,single:async()=>({data:{job_number:"HV-TEST",source:"base44"},error:null}),maybeSingle:async()=>({data:{mitti_piisa_template_id:template},error:null})};return q;}};
 const deps:Record<string,any>={"@/integrations/supabase/client.server":{supabaseAdmin:admin},"./workflow.server":{WorkflowError:Error,logEvent:async()=>{}},"./mitti.core":core,"./mitti.server":{realMittiCall:call,mittiCallFor:async(c:any)=>c},"./requirements.server":{jobScope:async()=>{throw Error("Explicit A5 update must not read Ready Check");}}};
 // Execute the production date writer with a mocked Mitti API.
 const source=readFileSync("src/lib/mitti-pickup.server.ts","utf8");const ast=ts.createSourceFile("pickup",source,ts.ScriptTarget.Latest,true);
 const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&["dateItemOf","updateMittiFormDate"].includes(n.name?.text??"")).map(n=>n.getText(ast)).join("\n");
 const api:any={};new Function("exports","require","admin","jobScope","mittiApi","realMittiCall","parseAudit","validateStoredMittiAudit","norm","WorkflowError","logEvent",ts.transpile(functions,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(p);return deps[p];},admin,deps["./requirements.server"].jobScope,core.mittiApi,call,core.parseAudit,core.validateStoredMittiAudit,core.norm,Error,async()=>{});
 return {api,call,writes,done:()=>{completed=true;},wrong:()=>{wrong=true;}};
}
test("moving an installation changes the A5 Install date through Mitti, not the Ready Check date",async()=>{const f=fixture();expect(await f.api.updateMittiFormDate("j","2026-11-17T00:00:00Z","actor",f.call,{auditId:"A5",kind:"install"})).toEqual({updated:true});expect(f.writes).toEqual([{method:"POST",path:"/audits/A5/update_text_items",body:{items:[{item_id:"date",type:"datetime",responses:{datetime:"2026-11-17T00:00:00Z"}}]}}]);});
test("a complete A5 is never date-edited",async()=>{const f=fixture();f.done();expect((await f.api.updateMittiFormDate("j","2026-11-17T00:00:00Z","actor",f.call,{auditId:"A5",kind:"install"})).updated).toBe(false);expect(f.writes).toEqual([]);});
test("an unrelated template is refused before a date write",async()=>{const f=fixture();f.wrong();await expect(f.api.updateMittiFormDate("j","2026-11-17T00:00:00Z","actor",f.call,{auditId:"A5",kind:"install"})).rejects.toThrow("template");expect(f.writes).toEqual([]);});