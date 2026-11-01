import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { simpleEmail } from '../src/lib/simple-email.core';
import { alertEmail } from '../src/lib/mitti-retry.core';
import { robotAlertContent } from '../src/lib/esc-robot-alert.core';
import { renderInstallDepositOwnerEmail, renderInstallerDepositPaidEmail, type DepositMessageFacts } from '../src/lib/deposit-request-email.core';

const facts: DepositMessageFacts = { name:'Jo',installer:'TEST Installer',jobNumber:'HV-TEST',address:'TEST address',ownerPhone:'0400000000',deadline:'2026-11-20',amountCents:12345,link:'https://example.test/my-job/token?screen=pay&step=deposit',bank:{},reference:'TEST',card:true };
describe('E0 approved email suite', () => {
  test('previous legacy renderers compile through the approved suite without changing links', () => {
    const url='https://example.test/job?a=1&b=2';
    const mails=[simpleEmail('Existing heading',['Existing sentence.'],{label:'Existing button',url},{testLabel:false}),
      alertEmail({jobNumber:'HV-TEST',address:'TEST address',kind:'piesa',tradeName:null,tradeEmail:null,bookingAt:null,error:'Existing error',jobUrl:url}),
      robotAlertContent({jobNumber:'HV-TEST',address:null,task:'install_notification',step:'Existing step',jobUrl:url}),
      ...(['request','day3','day7','paid'] as const).map(step=>renderInstallDepositOwnerEmail(facts,step)),renderInstallerDepositPaidEmail(facts)];
    for(const mail of mails) expect(mail.html).toContain('aria-roledescription="email"');
    expect(mails[0]?.html).toContain('href="https://example.test/job?a=1&amp;b=2"');
    expect(mails[0]?.text).toBe('Existing heading\n\nExisting sentence.\n\nExisting button: '+url);
  });
  test('send paths cannot import old presentation builders', () => {
    const source=readFileSync('src/lib/in-house-batch-email.server.ts','utf8')+readFileSync('src/lib/deposit-request-email.core.ts','utf8');
    expect(source).not.toMatch(/\b(emailShell|h1|p as paragraph)\b/);
  });
});