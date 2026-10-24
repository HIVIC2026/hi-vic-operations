import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule} from './helpers/qa-actual-source.mjs';

const h=(type,props,...children)=>({type,props:props??{},children});
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node.children.map(text).join('');
function find(node,label){if(node?.props?.onClick&&text(node)===label)return node;if(!node||typeof node!=='object')return null;for(const child of node.children??[]){const found=find(child,label);if(found)return found;}return null;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const z=new Proxy(()=>z,{get:()=>z,apply:()=>z});
const names=list=>Object.fromEntries(list.map(name=>[name,name]));

function centre(t,{query={},blockedPopup=false,issueError=null}={}){
 const prior={React:globalThis.React,window:globalThis.window};t.after(()=>Object.assign(globalThis,prior));globalThis.React={createElement:h,Fragment:'Fragment'};
 const io={calls:[],errors:[],successes:[],popups:[],refetch:0};
 const state=[];let cursor=0;
 globalThis.window={location:{origin:'https://example.invalid'},open:(url,target)=>{
  io.calls.push({kind:'popup',url,target});if(blockedPopup)return null;
  const popup={opener:{office:true},closed:false,path:null,close(){this.closed=true;},location:{replace:path=>{popup.path=path;}}};io.popups.push(popup);return popup;
 }};
 const call=(name,result)=>async args=>{io.calls.push({kind:name,args});if(issueError&&name.startsWith('issue'))throw new Error(issueError);return result;};
 const handlers={prepareQaJourneyAccess:call('prepare',{message:'Prepared only missing associations'}),issueQaPersonaLink:call('issuePersona',{tokenHash:'test-hash-which-is-not-a-live-token',next:'/home'}),issueQaWorkerLink:call('issueWorker',{path:'/w/test-worker-token'}),simulateQaJourneyTime:call('simulate',{}),simulateQaPayment:call('pay',{}),archiveQaJourney:call('archive',{}),createTestTradeAccounts:call('create',{})};
 const imports={
  '@tanstack/react-router':{createFileRoute:()=>options=>options,Link:'Link'},
  '@tanstack/react-query':{useQuery:()=>({isPending:false,refetch:()=>{io.refetch++;},...query})},
  '@tanstack/react-start':{useServerFn:fn=>fn},
  'lucide-react':names(['Clock3','ExternalLink','FlaskConical','Plus','Trash2','Users']),react:{useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return[state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}},
  sonner:{toast:{error:message=>io.errors.push(message),success:message=>io.successes.push(message)}},
  '@/components/portal/AppShell':{AppShell:'AppShell'},'@/components/portal/jo-tradie-panel':{JoTradiePanel:'JoTradiePanel'},
  '@/components/ui/badge':{Badge:'Badge'},'@/components/ui/button':{Button:'Button'},'@/components/ui/checkbox':{Checkbox:'Checkbox'},
  '@/components/ui/dialog':names(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogTrigger']),
  '@/components/ui/input':{Input:'Input'},'@/components/ui/label':{Label:'Label'},
  '@/lib/portal.functions':names(['createTestEnquiry','getAdminPipeline','getXeroConnection']),
  '@/lib/onboarding-links.functions':names(['clearOnboardingStartBlock','issueOnboardingLink','listOnboardingLinks','listOnboardingStartBlocks','revokeOnboardingLink','runOnboardingUploadCleanup']),
  '@/lib/test-accounts.functions':handlers,
  '@/lib/qa-role-link.core':loadModule('src/lib/qa-role-link.core.ts'),
 };
 io.components={...loadModule('src/routes/_authenticated/admin.test-centre.tsx',imports,'export { QaRoleControls };'),...loadModule('src/components/portal/xero-connection-card.tsx',imports)}; // Xero card moved to Settings › Xero (O7 build B)
 io.roles=()=>{cursor=0;return io.components.QaRoleControls({jobId:'isolated-qa-job'});};
 return io;
}

test('actual role controls: each Open action only issues access and renders a real-click isolated tab link',async t=>{
 const io=centre(t);
 for(const label of ['owner','installer boss','electrician','worker']){
  find(io.roles(),'Open as '+label).props.onClick();await tick();
  const anchor=find(io.roles(),'Open TEST '+label+' tab');assert.ok(anchor);assert.equal(anchor.type,'a');assert.equal(anchor.props.target,'_blank');assert.equal(anchor.props.rel,'noopener noreferrer');
  assert.ok(anchor.props.href.startsWith(label==='worker'?'/w/':'/qa-access?token_hash='));
 }
 assert.equal(io.calls.filter(c=>c.kind==='prepare').length,0);assert.equal(io.calls.filter(c=>c.kind==='issuePersona').length,3);assert.equal(io.calls.filter(c=>c.kind==='issueWorker').length,1);
 assert.equal(io.popups.length,0);assert.ok(!io.calls.some(c=>c.kind==='popup'));
 assert.equal(io.errors.length,0);
});

test('actual role controls: preparation is an explicit separate action that does not open a role',async t=>{
 const io=centre(t);const tree=io.roles();
 find(tree,'Prepare missing TEST associations').props.onClick();await tick();
 assert.deepEqual(io.calls.map(c=>c.kind),['prepare']);assert.equal(io.popups.length,0);assert.match(io.successes[0],/missing associations/);
});

test('actual role controls: popup blocking is irrelevant; denied access shows no link and never prepares',async t=>{
 const blocked=centre(t,{blockedPopup:true});find(blocked.roles(),'Open as worker').props.onClick();await tick();
 assert.deepEqual(blocked.calls.map(c=>c.kind),['issueWorker']);assert.ok(find(blocked.roles(),'Open TEST worker tab'));assert.equal(blocked.errors.length,0);
 const failed=centre(t,{issueError:'TEST worker was revoked'});find(failed.roles(),'Open as worker').props.onClick();await tick();
 assert.equal(find(failed.roles(),'Open TEST worker tab'),null);assert.match(failed.errors[0],/revoked/);assert.ok(!failed.calls.some(c=>c.kind==='prepare'||c.kind==='popup'));
});

const connection={configured:true,connected:true,checkedAt:'2026-10-20T10:00:00Z',error:null,
 orgs:[{name:'Demo Company (AU)',test:true},{name:'DC Construction Solutions',test:false}],
 routing:{liveCallsEnabled:false,testOrganisation:'Demo Company (AU)',liveOrganisation:null,liveCandidates:['DC Construction Solutions'],liveBlocker:'Live calls are switched off by the current launch setting.'}};

test('actual Xero card: available candidates are distinct from a switched-off live route and the check is read-only',async t=>{
 const io=centre(t,{query:{data:connection}});const tree=io.components.XeroConnectionCard();const rendered=text(tree);
 assert.match(rendered,/Available real candidatesDC Construction Solutions/);assert.match(rendered,/TEST job routeDemo Company/);assert.match(rendered,/Live job routeLive calls are switched off/);assert.match(rendered,/Live route blocker:/);assert.match(rendered,/Checked/);
 find(tree,'Check connection').props.onClick();assert.equal(io.refetch,1);assert.equal(io.calls.length,0);
});

test('actual Xero card: failed checks and active live routing display the returned state truthfully',async t=>{
 const failure=centre(t,{query:{data:{...connection,connected:false,orgs:[],error:'Xero credentials rejected',routing:{...connection.routing,testOrganisation:null,liveCandidates:[],liveBlocker:'Connection check failed'}}}});
 const failedText=text(failure.components.XeroConnectionCard());assert.match(failedText,/Connection check failed: Xero credentials rejected/);assert.ok(!failedText.includes('Available organisations were confirmed'));
 const enabled=centre(t,{query:{data:{...connection,routing:{...connection.routing,liveCallsEnabled:true,liveOrganisation:'DC Construction Solutions',liveBlocker:null}}}});
 const activeText=text(enabled.components.XeroConnectionCard());assert.match(activeText,/Live job routeDC Construction Solutions/);assert.ok(!activeText.includes('Live calls are switched off'));
});

function access(t,result,{reject=null,signOutError=null}={}){
 const prior={React:globalThis.React,window:globalThis.window,sessionStorage:globalThis.sessionStorage};t.after(()=>Object.assign(globalThis,prior));globalThis.React={createElement:h};
 const session=new Map([['office-sentinel','unchanged']]);globalThis.sessionStorage={getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,value)};
 const io={effects:[],errors:[],options:[],signOut:0,path:null,session};globalThis.window={location:{replace:path=>{io.path=path;}}};
 const imports={react:{useState:()=>[null,error=>io.errors.push(error)],useEffect:fn=>io.effects.push(fn)},
 '@tanstack/react-router':{createFileRoute:()=>options=>({...options,useSearch:()=>({token_hash:'fixture-hash-is-at-least-twenty-characters',next:'/home'})})},zod:{z},
 '@/assets/home-insulation-victoria-logo.png.asset.json':{default:{url:'/fixture-logo'}},
 '@/integrations/supabase/client':{createSupabaseClient:options=>{io.options.push(options);return {auth:{verifyOtp:async()=>{if(reject)throw new Error(reject);return result;},signOut:async()=>{io.signOut++;return{error:signOutError?{message:signOutError}:null};}}};}}};
 const module=loadModule('src/routes/qa-access.tsx',imports,'export { QaAccess };');module.QaAccess();io.effects[0]();return io;
}

test('actual QA entry route: successful access uses its own per-tab auth key and preserves office storage',async t=>{
 const io=access(t,{data:{user:{email:'qa.persona@hivic-test.example',user_metadata:{qa_test:true}},session:{access_token:'isolated-fixture-token'}},error:null});await tick();
 assert.equal(io.options[0].storageKey,'hivic-qa-fixture-hash');assert.equal(io.session.get('hivic-qa-auth-storage-key'),io.options[0].storageKey);assert.equal(io.session.get('office-sentinel'),'unchanged');assert.equal(io.path,'/home');
});

test('actual QA entry route: rejected or failed Auth does not select a QA session or alter office storage',async t=>{
 const bad=access(t,{data:{user:{email:'actual@example.com',user_metadata:{qa_test:false}},session:{}},error:null});await tick();
 assert.equal(bad.signOut,1);assert.equal(bad.path,null);assert.equal(bad.session.has('hivic-qa-auth-storage-key'),false);assert.equal(bad.session.get('office-sentinel'),'unchanged');assert.match(bad.errors[0],/approved TEST/);
 const failure=access(t,null,{reject:'Auth network failed'});await tick();assert.match(failure.errors[0],/Auth network failed/);assert.equal(failure.path,null);assert.equal(failure.session.has('hivic-qa-auth-storage-key'),false);
 const signOut=access(t,{data:{user:null},error:{message:'Expired token'}},{signOutError:'Could not close rejected TEST session'});await tick();assert.match(signOut.errors[0],/Could not close/);assert.equal(signOut.path,null);
});
