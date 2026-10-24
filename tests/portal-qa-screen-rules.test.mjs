// Current redirect and stored-name QA rules, with local framework/DOM boundaries only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.HIVIC_PORTAL_QA_TEST_SOURCE_ROOT || repo;
const base = process.env.HIVIC_PORTAL_QA_TEST_BASE_ROOT;
const require = process.env.HIVIC_PORTAL_QA_TEST_DEPS_ROOT ? createRequire(resolve(process.env.HIVIC_PORTAL_QA_TEST_DEPS_ROOT, 'package.json')) : createRequire(import.meta.url);
const ts = require('typescript');
const read = name => readFileSync(existsSync(resolve(root,name)) ? resolve(root,name) : resolve(base || root,name),'utf8');
const h = (type,props,...children) => ({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)});
const text = n => n==null||n===false?'':typeof n==='object'?(n.children||[]).map(text).join(''):String(n);
const all = (n,p) => !n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...(n.children||[]).flatMap(x=>all(x,p))];
function evaluate(code,imports={}) {
  const compiled=ts.transpileModule(code,{fileName:'fixture.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
  const module={exports:{}};
  new Function('React','require','module','exports',compiled)({createElement:h},name=>imports[name]||{},module,module.exports);
  return module.exports;
}
function route(name,data) {
  return evaluate(read('src/routes/_authenticated/'+name+'.tsx'),{
    '@tanstack/react-router':{createFileRoute:()=>options=>options,redirect:options=>({redirect:options})},
    '@tanstack/react-query':{useQuery:()=>({data,error:null})},
    '@tanstack/react-start':{useServerFn:fn=>fn},
    '@/lib/utils':{cn:(...x)=>x.filter(Boolean).join(' ')},
  }).Route;
}
function screenRules() {
  const source=ts.createSourceFile('portal-qa.ts',read('scripts/portal-qa.ts'),ts.ScriptTarget.Latest,true);
  const vars={};
  function walk(node){if(ts.isVariableDeclaration(node)&&['RETIRED','screens'].includes(node.name.getText(source)))vars[node.name.getText(source)]=node.initializer.getText(source);ts.forEachChild(node,walk);}
  walk(source);assert.ok(vars.RETIRED&&vars.screens);
  return evaluate('const ownerJob=undefined; const RETIRED='+vars.RETIRED+'; export const screens='+vars.screens+';').screens;
}
const screens=screenRules();
test('legacy operations screenshot checks the actual current Enquiries destination',()=>{
  const spec=screens.find(s=>s.step==='office-operations');
  assert.throws(()=>route('admin.operations').beforeLoad({search:{}}),e=>e.redirect.to===spec.expectedPath&&e.redirect.replace===true);
  assert.equal(spec.expectedPath,'/admin/enquiries');assert.deepEqual(spec.mustSee,['Enquiries','Fix details','Waiting on owner']);
  assert.match(read('src/components/portal/EnquiriesScreen.tsx'),/<h1[^>]*>Enquiries<\/h1>/);
  assert.match(read('src/lib/office-jobs.core.ts'),/Fix details/);assert.match(read('src/lib/office-jobs.core.ts'),/Waiting on owner/);
});
test('legacy campaign screenshot checks the actual Templates email redirect and current read-only wording',()=>{
  const spec=screens.find(s=>s.step==='office-campaign-emails');
  assert.throws(()=>route('admin.campaign-emails').beforeLoad(),e=>e.redirect.to===spec.expectedPath&&e.redirect.search.cat===spec.expectedSearch.cat);
  assert.equal(spec.expectedPath,'/admin/templates');assert.deepEqual(spec.expectedSearch,{cat:'email'});
  assert.deepEqual(spec.mustSee,['Templates','Viewing here never sends, saves or connects anything.']);
  for(const needle of spec.mustSee)assert.ok(read('src/components/portal/template-hub.tsx').includes(needle));
});
test('only the partner stored-name branding check is scoped; every other forbidden term remains global',()=>{
  const partners=screens.find(s=>s.step==='office-partners');
  assert.deepEqual(partners.mustNotSeeExactOutside,[{text:'HI VIC',ignoreSelector:'[data-partner-record-name]'}]);
  assert.deepEqual(partners.mustNotSeeExact,['undefined','NaN','[object','50% deposit','Lorem ipsum','TODO']);
  for(const spec of screens.filter(s=>s.step!=='office-partners'))assert.ok(spec.mustNotSeeExact.includes('HI VIC'));
});
test('partner stored names keep their narrow record marker on Partners › Approved (O5; overview cards removed)',()=>{
  const spec=screens.find(s=>s.step==='office-partners');
  assert.equal(spec.path,'/admin/partners?tab=approved');assert.equal(spec.expectedPath,'/admin/partners');
  assert.throws(()=>route('admin.partners-overview').beforeLoad(),e=>e.redirect.to==='/admin/partners'&&e.redirect.replace===true);
  const page=read('src/routes/_authenticated/admin.partners.tsx');
  assert.match(page,/data-partner-record-name[^>]*>\{b\.name\}<\/Link>/);
  assert.match(page,/<PageHeader title="Partners"/);
});
function outside(records) {
  const match=read('e2e/journey/shoot.py').match(/TEXT_OUTSIDE_RECORDS = """([\s\S]*?)"""/);assert.ok(match);
  const nodes=records.map(r=>({textContent:r.text,parentElement:{closest:s=>r.record&&s==='[data-partner-record-name]'?{}:null,getClientRects:()=>r.hidden?[]:[{}],visibility:r.visibility||'visible'}}));
  let i=0;const context={document:{body:{},createTreeWalker:()=>({nextNode:()=>nodes[i++]||null})},NodeFilter:{SHOW_TEXT:4},getComputedStyle:el=>({visibility:el.visibility})};
  return vm.runInNewContext('('+match[1]+')',context)('[data-partner-record-name]');
}
test('actual browser text selector excludes a stored name without excluding identical app wording',()=>{
  assert.equal(outside([{text:'Partners'},{text:'HI VIC Fixture Business',record:true}]),'Partners');
  const scoped=outside([{text:'HI VIC Fixture Business'},{text:'HI VIC Fixture Business',record:true}]);
  assert.equal(scoped,'HI VIC Fixture Business');assert.ok(scoped.includes('HI VIC'));
});
test('actual browser text selector retains visible errors and ignores hidden text only',()=>{
  assert.equal(outside([{text:'Application error'},{text:'Hidden HI VIC',hidden:true},{text:'Invisible HI VIC',visibility:'hidden'},{text:'HI VIC Fixture Business',record:true}]),'Application error');
});

function emailRunner() {
  const source=ts.createSourceFile('portal-qa.ts',read('scripts/portal-qa.ts'),ts.ScriptTarget.Latest,true);let found;
  function walk(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='isolatedEmailFiles')found=node.getText(source);ts.forEachChild(node,walk);}
  walk(source);assert.ok(found);return evaluate(found+'\nexport { isolatedEmailFiles };').isolatedEmailFiles;
}
function emailFixture({results={},durations={},missing=[],globalMs=500_000}={}) {
  let elapsed=0;const calls=[],rows=[],logs=[];
  const io={now:()=>elapsed,leftMs:()=>globalMs-elapsed,exists:file=>!missing.includes(file),record:row=>rows.push(row),log:s=>logs.push(s),run:(file,cap)=>{calls.push({file,cap});elapsed+=durations[file]||0;return results[file]||{status:0,stdout:'2 pass\n0 fail'};}};
  return {run:files=>emailRunner()(files,io),calls,rows,logs};
}
test('email files run separately, aggregate every pass and persist each file before continuing',()=>{
  const io=emailFixture();assert.deepEqual(io.run(['one.test.ts','two.test.ts']),{status:'passed',pass:4,fail:0,passedFiles:2,failedFiles:0,notRunFiles:0});
  assert.deepEqual(io.calls.map(c=>c.file),['one.test.ts','two.test.ts']);assert.equal(io.rows.length,2);assert.equal(io.logs.length,2);assert.match(io.logs[1],/one\.test\.ts/);assert.match(io.logs[1],/two\.test\.ts/);
});
for(const [name,result] of [
  ['assertion failures',{status:1,stderr:'3 pass\n2 fail'}],
  ['timeout after partial output',{status:null,stderr:'1 pass\n0 fail',error:{message:'ETIMEDOUT'},signal:'SIGTERM'}],
  ['nonzero exit without a test summary',{status:1,stderr:'module import failed'}],
  ['zero tests with exit zero',{status:0,stdout:'0 pass\n0 fail'}],
  ['contradictory fail summary with exit zero',{status:0,stdout:'3 pass\n1 fail'}],
]) test('email aggregate remains failed for '+name,()=>{
  const io=emailFixture({results:{'bad.test.ts':result}});const summary=io.run(['bad.test.ts','good.test.ts']);
  assert.equal(summary.status,'failed');assert.equal(summary.failedFiles,1);assert.equal(summary.passedFiles,1);assert.equal(io.rows[0].status,'failed');assert.equal(io.calls.length,2);
});
test('email phase shares the original 120-second cap and marks remaining files NOT_RUN',()=>{
  const io=emailFixture({durations:{'one.test.ts':111_000,'two.test.ts':9_000}});const summary=io.run(['one.test.ts','two.test.ts','three.test.ts']);
  assert.deepEqual(io.calls,[{file:'one.test.ts',cap:120_000},{file:'two.test.ts',cap:9_000}]);assert.equal(summary.status,'not_run');assert.equal(summary.notRunFiles,1);assert.match(io.rows[2].detail,/budget exhausted/);
});
test('email children respect the remaining overall budget and report missing named files',()=>{
  const io=emailFixture({globalMs:25_000,durations:{'one.test.ts':25_000},missing:['missing.test.ts']});const summary=io.run(['missing.test.ts','one.test.ts','two.test.ts']);
  assert.deepEqual(io.calls,[{file:'one.test.ts',cap:25_000}]);assert.equal(summary.status,'not_run');assert.equal(summary.notRunFiles,2);assert.match(io.rows[0].detail,/file is missing/);assert.match(io.rows[2].detail,/budget exhausted/);
});
