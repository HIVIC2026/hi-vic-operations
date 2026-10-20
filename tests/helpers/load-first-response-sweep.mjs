// Load actual source, replacing only its imported I/O boundaries. No generated copy of the worker logic.
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { resolve } from 'node:path';

const localRequire = nodeModule.createRequire(import.meta.url);
export const testRequire = process.env.HIVIC_RETRY_TEST_DEPS_ROOT
  ? nodeModule.createRequire(resolve(process.env.HIVIC_RETRY_TEST_DEPS_ROOT, 'package.json'))
  : localRequire;

export function stripActualTypeScript(source) {
  if (typeof nodeModule.stripTypeScriptTypes === 'function') {
    return nodeModule.stripTypeScriptTypes(source, { mode: 'strip' });
  }
  const ts = testRequire('typescript');
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}

export const readActualSource = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const core = stripActualTypeScript(readActualSource('src/lib/automatic-first-response.core.ts')).replaceAll(/^export /gm, '');
export const { sweepEligible } = new Function(core + '\nreturn { sweepEligible };')();

export function loadActualSweep(deps) {
  const adapted = readActualSource('src/lib/first-response-sweep.server.ts')
    .replace('import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";', 'const admin = deps.admin;')
    .replace('import { sweepEligible } from "./automatic-first-response.core";', 'const sweepEligible = deps.sweepEligible;')
    .replaceAll(/import\("([^"]+)"\)/g, 'deps.load("$1")');
  const js = stripActualTypeScript(adapted).replaceAll(/^export /gm, '');
  return new Function('deps', js + '\nreturn sweepUnansweredFirstResponses;')({ sweepEligible, ...deps });
}
