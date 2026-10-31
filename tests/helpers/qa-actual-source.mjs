// Actual TypeScript handlers and helpers; only framework, Auth and database I/O are substituted.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
export const testRequire = process.env.HIVIC_QA_TEST_DEPS_ROOT
  ? createRequire(resolve(process.env.HIVIC_QA_TEST_DEPS_ROOT,'package.json')) : createRequire(import.meta.url);
const ts=testRequire('typescript');
export const readSource=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

export function loadModule(path,imports={},extra='') {
  const source=readSource(path)+'\n'+extra;
  const result=ts.transpileModule(source,{fileName:path,reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}});
  const errors=(result.diagnostics??[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
  if(errors.length) throw new Error(errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join('\n'));
  const exports={};const module={exports};
  new Function('require','module','exports',result.outputText)(name=>{
    if(!(name in imports)) throw new Error('Unexpected actual-source dependency: '+name);
    return imports[name];
  },module,exports);
  return module.exports;
}

export function loadHandlers(admin,context) {
  const workflow={WorkflowError:class WorkflowError extends Error{}};
  const marks=loadModule('src/lib/test-send.core.ts');
  const workers=loadModule('src/lib/worker-links.core.ts');
  const links=loadModule('src/lib/qa-role-link.core.ts');
  // Execute the real descriptive qualification helper. Other activation functions are not invoked by QA preparation.
  const activation=loadModule('src/lib/partner-activation.core.ts',{'./installer-onboarding.core':{},'./rec-onboarding.core':{}});
  const server=loadModule('src/lib/qa-access.server.ts',{'./workflow.server':workflow,'./test-send.core':marks,'./worker-links.core':workers,'./qa-role-link.core':links,'./partner-activation.core':activation,'./dad-test-login.core':loadModule('src/lib/dad-test-login.core.ts')});
  const z=new Proxy(()=>z,{get:()=>z,apply:()=>z});
  const createServerFn=()=>({middleware(){return this;},inputValidator(){return this;},handler(fn){return args=>fn({...args,context});}});
  return loadModule('src/lib/test-accounts.functions.ts',{'@tanstack/react-start':{createServerFn},zod:{z},
    '@/integrations/supabase/auth-middleware':{requireSupabaseAuth:()=>{}},'./workflow.server':workflow,
    '@/integrations/supabase/client.server':{supabaseAdmin:admin},'./qa-access.server':server,
    // Full TEST-isolation check (real one is covered by qa-office-job-scope-practice-db); tests may override via context.officeJob.
    // Mirrors the admin branch of the real one (rpc is_admin -> "Admin only."); TEST office tests override via context.officeJob.
    './qa-office-access.server':{requireOfficeJob:async(sb,jobId)=>{if(context.officeJob)return context.officeJob(jobId);const r=await sb.rpc('is_admin');if(r.error)throw new Error(r.error.message);if(!r.data)throw new Error('Admin only.');return 'admin';}}});
}
