import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/qa-actual-source.mjs';
const h=(type,props,...children)=>({type,props:props??{},children});
const text=n=>n==null||typeof n==='boolean'?'':typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):(n.children??[]).map(text).join('');
const find=(n,label)=>{if(n?.props?.onClick&&text(n)===label)return n;for(const c of n?.children??[]){const f=find(c,label);if(f)return f;}return null;};
const tick=()=>new Promise(r=>setImmediate(r));
function ui(t,{roles=['admin'],fail=false}={}){
 const prior={React:globalThis.React,window:globalThis.window,document:globalThis.document};t.after(()=>Object.assign(globalThis,prior));
 globalThis.React={createElement:h};let cursor=0;const states=[],refs=[];const io={calls:[],downloads:[]};
 const refCursor={value:0};
 globalThis.window={matchMedia:()=>({matches:false}),setTimeout:()=>0};
 globalThis.document={createElement:()=>({click(){io.downloads.push(this.download);},remove(){}}),body:{appendChild(){}}};
 const names=(list)=>Object.fromEntries(list.map(x=>[x,x]));
 const module=loadModule('src/routes/_authenticated/admin.users.tsx',{
 '@tanstack/react-router':{createFileRoute:()=>x=>x},'@tanstack/react-query':{useQuery:()=>({isPending:true})},
 '@/components/portal/AppShell':{AppShell:'AppShell'},'@/hooks/use-me':{useMe:()=>({data:{roles}}),useAction:()=>()=>{}},
 '@/lib/portal.functions':names(['setUserBusiness','setUserRole']),'@/components/ui/checkbox':{Checkbox:'Checkbox'},'@/components/ui/button':{Button:'Button'},
 '@tanstack/react-start':{useServerFn:x=>x},'@/lib/admin-records.functions':{getAdminUsers:()=>{}},
 '@/lib/mitti-membership.functions':names(['checkAllTrades','checkMittiAccess']),'@/lib/mitti-membership.core':names(['MITTI_ACCESS_LABEL','mittiAccessOf','mittiCheckedLabel']),
 react:{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},useRef:initial=>{const i=refCursor.value++;return refs[i]??(refs[i]={current:initial});}},
 'lucide-react':{Download:'Download'},'@/lib/dad-test-login.functions':{downloadDadTestLogin:async args=>{io.calls.push(args);await tick();if(fail)throw new Error('do not surface provider error');return{filename:'Dad-TEST-installer-login.txt',mimeType:'text/plain',content:'synthetic private test fixture'};}},
 },'export { Users };');
 io.render=()=>{cursor=0;refCursor.value=0;return module.Users();};return io;
}
test('Office download calls guarded action once with no caller-selected target and downloads private file',async t=>{const io=ui(t);const button=find(io.render(),'Download Dad’s TEST login');assert.ok(button);const a=button.props.onClick();button.props.onClick();await tick();await tick();assert.deepEqual(io.calls,[{data:{}}]);assert.deepEqual(io.downloads,['Dad-TEST-installer-login.txt']);assert.ok(find(io.render(),'Save private login file'));});
test('non-Office users cannot see download control',t=>{const io=ui(t,{roles:['installer']});assert.equal(find(io.render(),'Download Dad’s TEST login'),null);assert.equal(io.calls.length,0);});
test('failed issue creates no file download or exposed raw error',async t=>{const io=ui(t,{fail:true});find(io.render(),'Download Dad’s TEST login').props.onClick();await tick();await tick();assert.equal(io.downloads.length,0);assert.equal(find(io.render(),'Save private login file'),null);assert.ok(!text(io.render()).includes('provider error'));});
