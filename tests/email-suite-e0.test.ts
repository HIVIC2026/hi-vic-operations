import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { simpleEmail } from '../src/lib/simple-email.core';
import { alertEmail } from '../src/lib/mitti-retry.core';
import { robotAlertContent } from '../src/lib/esc-robot-alert.core';
import { renderInstallDepositOwnerEmail, renderInstallerDepositPaidEmail, type DepositMessageFacts } from '../src/lib/deposit-request-email.core';
import { customReviewMail } from '../src/lib/enquiry-review-custom.core';
import { TEMPLATE_ENTRIES } from '../src/lib/template-hub.core';

const facts: DepositMessageFacts = { name:'Jo',installer:'TEST Installer',jobNumber:'HV-TEST',address:'TEST address',ownerPhone:'0400000000',deadline:'2026-11-20',amountCents:12345,link:'https://example.test/my-job/token?screen=pay&step=deposit',bank:{accountName:'TEST',bsb:null,accountNumber:null,payId:null,configured:false},reference:'TEST',card:true };
describe('E0 approved email suite', () => {
  test('previous legacy renderers compile through the approved suite without changing links', () => {
    const url='https://example.test/job?a=1&b=2';
    const mails=[simpleEmail('Existing heading',['Existing sentence.'],{label:'Existing button',url},{testLabel:false}),
      alertEmail({jobNumber:'HV-TEST',address:'TEST address',kind:'piesa',tradeName:null,tradeEmail:null,bookingAt:null,error:'Existing error',jobUrl:url}),
      robotAlertContent({jobNumber:'HV-TEST',address:null,task:'install_notification',step:'Existing step',jobUrl:url}),
      ...(['request','day3','day7','paid'] as const).map(step=>renderInstallDepositOwnerEmail(facts,step)),renderInstallerDepositPaidEmail(facts),customReviewMail({subject:'Existing subject',text:'Existing text',link:{label:'Existing button',url}})];
    for(const mail of mails) expect(mail.html).toContain('aria-roledescription="email"');
    expect(mails[0]?.html).toContain('href="https://example.test/job?a=1&amp;b=2"');
    expect(mails[0]?.text).toBe('Existing heading\n\nExisting sentence.\n\nExisting button: '+url);
  });
  test('all registered sending templates use the approved suite; composed drafts are explicitly not delivery templates', () => {
    const emails=TEMPLATE_ENTRIES.filter(e=>e.kind==='email');
    expect(emails.length).toBeGreaterThan(50);
    for(const entry of emails){
      if(entry.source.builder==='src/lib/email-reply.core.ts')continue; // draft-only, never a send endpoint
      const rendered=entry.render();
      if(rendered.kind!=='email')throw Error(entry.id+' did not render email');
      expect(rendered.html,entry.id).toContain('aria-roledescription="email"');
    }
  });
  test('send paths cannot import old presentation builders', () => {
    const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):/\.tsx?$/.test(e.name)?[join(dir,e.name)]:[]);
    const retired=['emailShell','h1','greeting','greenLead','button','priceBox','twoFigureBox','includedCard','notIncludedCard','checkList','dateCard','resultCard','quoteTable','invoiceTable','mistBox','amberBox','redBox','tapTimeButtons'];
    for(const path of walk('src')){
      const source=readFileSync(path,'utf8');
      for(const imported of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]*email-kit\.core)['"]/g)) {
        expect(imported[1],path).not.toMatch(new RegExp('\\b('+retired.join('|')+')\\b'));
      }
      expect(source,path).not.toMatch(/K\.(emailShell|h1|button|priceBox|dateCard|mistBox)\s*\(/);
    }
    expect(readFileSync('src/lib/email-kit.core.ts','utf8')).not.toContain('export function emailShell');
  });
  test('every application email delivery entry has an approved renderer in its source graph', () => {
    const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):/\.tsx?$/.test(e.name)?[join(dir,e.name)]:[]);
    const paths=walk('src');const sources=new Map(paths.map(path=>[resolve(path),readFileSync(path,'utf8')]));
    const suite=resolve('src/lib/mail-mjml.core.ts');
    const reachesSuite=(path:string,seen=new Set<string>()):boolean=>{
      if(path===suite)return true;if(seen.has(path))return false;seen.add(path);
      const source=sources.get(path);if(!source)return false;
      for(const match of source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)){
        const target=match[1];if(!target)continue;
        const base=target.startsWith('@/')?resolve('src',target.slice(2)):target.startsWith('.')?resolve(dirname(path),target):null;
        if(!base)continue;
        for(const candidate of [base,base+'.ts',base+'.tsx',join(base,'index.ts')])if(reachesSuite(candidate,seen))return true;
      }return false;
    };
    const sends=/\b(?:sendGuardedOwnerEmail|sendTestEmail|sendOfficeEmail|resendSend|sendViaOutlook|sendMittiFailureAlert|sendRobotFailureAlert|sendInHouseOfficeAlert)\s*\(/;
    const transportOnly=new Set(['src/lib/outlook-send.server.ts']);
    const roots=paths.filter(path=>sends.test(sources.get(resolve(path))??'')&&!transportOnly.has(path));
    expect(roots.length).toBeGreaterThan(50);
    for(const path of roots){
      expect(reachesSuite(resolve(path)),path+' has no approved renderer').toBe(true);
      expect(sources.get(resolve(path)),path+' builds raw fallback HTML').not.toMatch(/(?:const\s+html\s*=|html\s*:)\s*`<(?:pre|p|div|html|!doctype)\b/i);
    }
    // The provider-independent bridge is transport-only; it must continue forwarding the rendered body verbatim.
    expect(readFileSync('src/lib/delivery.core.ts','utf8')).toContain('html: msg.html');
  });
});