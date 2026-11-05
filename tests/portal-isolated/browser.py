"""PR-safe real React page/component checks. NO production backend or auth proof."""
import asyncio, json, os, sys, subprocess, time
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/portal-qa-isolated');OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:4186';JOB='/field/00000000-0000-4000-8000-000000000101';STORE='isolated-portal-fixtures-v1'
results=[];coverage=[];controls=[];external=[]
async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True)
  for width in [390,1280]:
   c=await browser.new_context(viewport={'width':width,'height':844 if width==390 else 1800})
   await c.tracing.start(screenshots=True,snapshots=True,sources=True)
   async def boundary(route):
    if route.request.url.startswith(BASE+'/'): await route.continue_()
    else: external.append({'url':route.request.url.split('?')[0],'status':'BLOCKED'});await route.abort()
   await c.route('**/*',boundary);p=await c.new_page();p.set_default_timeout(3000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
   async def check(name,fn):
    errors.clear()
    try:
     await fn()
     assert not errors,errors
     results.append({'name':name,'width':width,'status':'PASS','url':p.url})
    except Exception as e: results.append({'name':name,'width':width,'status':'FAIL','url':p.url,'error':str(e)[:600]})
    (OUT/'partial-results.json').write_text(json.dumps(results,indent=2));await p.screenshot(path=str(OUT/f'{width}-{len(results):02d}.png'))
   async def open_page(path,role='installer',text=None):
    await p.goto(BASE+path);await p.evaluate('(r)=>sessionStorage.setItem("qa-role",r)',role);await p.reload()
    if text: await p.get_by_text(text,exact=False).first.wait_for(timeout=6000)
    body=await p.locator('body').inner_text();assert body.strip() and 'Something went wrong!' not in body,body[:300]
    assert await p.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
    controls.append({'url':p.url,'role':role,'width':width,'controls':await p.locator('button,input,select,a,summary').evaluate_all('(els)=>els.map(e=>({tag:e.tagName,text:(e.textContent||e.getAttribute("aria-label")||e.getAttribute("placeholder")||"").trim().slice(0,140),type:e.getAttribute("type"),disabled:e.disabled||false}))')})
    coverage.append({'requested_path':path,'landed_path':p.url.removeprefix(BASE),'persona':role,'viewport':{'width':width},'content_verified':True,'ok':True,'scope':'mocked page/component; real auth/layout loaders excluded'})
   async def home():await open_page('/field',text='Measure and quote')
   await check('Installer dashboard render and mobile bounds',home)
   async def drill():
    await p.get_by_role('button',name='Measure and quote',exact=True).click() if await p.get_by_role('button',name='Measure and quote',exact=True).count() else await p.get_by_role('link',name='Measure and quote',exact=True).click()
    await p.get_by_role('button',name='Do a Ready Check on site',exact=True).wait_for();assert p.url==BASE+JOB
   await check('Dashboard to own-customer job drilldown',drill)
   async def failure():
    await p.evaluate('(k)=>{let s=JSON.parse(localStorage.getItem(k));s.fail="requestOwnMittiForm";localStorage.setItem(k,JSON.stringify(s))}',STORE)
    await p.get_by_role('button',name='Do a Ready Check on site',exact=True).click();await p.get_by_role('alert').first.wait_for();assert await p.get_by_role('button',name='Do a Ready Check on site',exact=True).is_enabled()
   await check('Failed request retains inline error and retry control (regression)',failure)
   async def retry():
    await p.get_by_role('button',name='Do a Ready Check on site',exact=True).click();await p.get_by_text('Mitti form on its way',exact=False).wait_for();s=await p.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',STORE);assert s['mitti'] is True
   await check('Retry saves choice to disposable fixture',retry)
   async def refresh():
    await p.reload();await p.get_by_text('Mitti form on its way',exact=False).wait_for();assert p.url==BASE+JOB
   await check('Job deep-link refresh preserves mocked choice',refresh)
   async def price():
    await p.get_by_label('Your price inc GST',exact=True).fill('2500');await p.get_by_role('button',name='Send to quote',exact=False).click();await p.get_by_text('Price saved:',exact=False).wait_for();s=await p.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',STORE);assert s['price']['record']['price_inc_gst']==2500
   await check('Price submit and fixture readback',price)
   async def price_refresh():
    await p.reload();await p.get_by_text('Price saved:',exact=False).wait_for();await p.get_by_role('button',name='Change',exact=True).click();assert await p.get_by_label('Your price inc GST',exact=True).input_value()=='2500'
   await check('Saved price refresh and Change readback',price_refresh)
   async def tabs():
    tab=await c.new_page();await tab.goto(BASE+'/field');await tab.get_by_text('Quote being prepared',exact=True).wait_for()
    await p.get_by_label('Your price inc GST',exact=True).fill('2600');await p.get_by_role('button',name='Send to quote',exact=False).click();await p.get_by_text('$2,600',exact=False).first.wait_for()
    await tab.goto(BASE+JOB);await tab.get_by_text('$2,600',exact=False).first.wait_for();await tab.screenshot(path=str(OUT/f'{width}-tab-readback.png'));await tab.close()
   await check('Second tab navigation reads latest fixture price (not realtime/auth proof)',tabs)
   async def back():
    await p.get_by_role('link',name='‹ My work',exact=False).click();await p.get_by_text('Quote being prepared',exact=True).wait_for();await p.go_back();await p.get_by_text('Price saved:',exact=False).wait_for()
   await check('Back navigation retains saved fixture value',back)
   async def portal():
    await p.evaluate('(k)=>localStorage.removeItem(k)',STORE);await open_page(JOB,text='Measure and quote');await p.get_by_role('button',name='Enter the details here',exact=False).click();await p.get_by_label('Install m²',exact=True).fill('100');await p.get_by_label('Removal m²',exact=True).fill('0');await p.get_by_label("What's in the ceiling now?",exact=True).select_option('none');await p.get_by_label('How did you measure it?',exact=True).select_option('other');await p.get_by_label('How did you measure it?',exact=True).last.fill('Synthetic independent measurements') if await p.get_by_label('How did you measure it?',exact=True).count()==1 else await p.locator('textarea').first.fill('Synthetic independent measurements')
    await p.get_by_label('Access',exact=True).select_option('standard');await p.get_by_label('Your price inc GST',exact=True).fill('2700');await p.get_by_role('button',name='Send to quote',exact=False).click();await p.get_by_text('saved',exact=False).first.wait_for();s=await p.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',STORE);assert s['price']['record']['price_inc_gst']==2700 and not s['mitti']
   await check('Portal Ready Check submit/readback without Mitti',portal)
   async def office():await open_page('/admin/needs-me','office','QUOTES TO CHECK')
   await check('Office Needs me and quote disclosure inventory',office)
   async def office_drill():
    await p.get_by_role('button',name='Check',exact=True).click() if await p.get_by_role('button',name='Check',exact=True).count() else await p.get_by_role('link',name='Check',exact=True).click()
    await p.wait_for_timeout(200);assert '/admin/jobs/' in p.url;raise AssertionError('BLOCKED: office job page fixture not implemented; no handoff workflow proof')
   await check('Office quote drilldown destination',office_drill)
   if results[-1]['status']=='FAIL' and 'BLOCKED:' in results[-1].get('error',''):results[-1]['status']='BLOCKED'
   async def team():
    await open_page('/field/business/team','installer','Add a person');await p.get_by_label('Full name',exact=True).fill('Synthetic Crew');await p.get_by_label('Mobile',exact=True).fill('0400000000');await p.get_by_label('Date of birth',exact=True).fill('1990-01-01');await p.get_by_label('CII/EEC certificate number',exact=True).fill('TEST-CII-1');await p.get_by_label('CII/EEC expiry date',exact=True).fill('2030-01-01');await p.get_by_role('button',name='Add to team',exact=True).click();await p.get_by_text('Team member saved:',exact=False).wait_for();s=await p.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',STORE);assert s['team'][-1]['certificateNumber']=='TEST-CII-1'
   await check('Team submit and fixture readback',team)
   async def add():await open_page('/partner/import','installer','Add job');await p.get_by_label("Owner's name",exact=True).fill('Synthetic Add Owner');await p.reload();assert await p.get_by_label("Owner's name",exact=True).input_value()=='Synthetic Add Owner'
   await check('Add job mobile fields and draft refresh (save not run)',add)
   for path,role in [('/installer-onboarding','installer'),('/electrician-onboarding','rec')]:
    async def onboarding(path=path,role=role):
     await open_page(path,role,'Start registration');await p.get_by_role('button',name='Start registration',exact=False).click();await p.get_by_text('Join as staff',exact=True).wait_for();assert await p.evaluate('document.documentElement.scrollWidth<=innerWidth')
    await check(role+' onboarding start only',onboarding)
   async def templates():await open_page('/admin/templates','office','Off — waiting');assert await p.get_by_text('Off — waiting',exact=False).count()>0
   await check('Templates OFF rendering; no approval clicks',templates)
   async def safety():
    await open_page('/qa/safety','installer','Choose your electrician');book=p.get_by_role('button',name='Book',exact=True);assert await book.is_disabled();await p.locator('select').select_option('synthetic-electrician');await p.locator('input[type=date]').fill('2026-11-20');await p.locator('input[type=time]').fill('10:00');assert await book.is_enabled();await book.click();await p.get_by_text('Booking saved:',exact=False).wait_for();s=await p.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',STORE);assert s['booking']['jobId'].endswith('101')
   await check('Safety check isolated component Book and local fixture readback',safety)
   await c.tracing.stop(path=str(OUT/f'trace-{width}.zip'));await c.close()
  await browser.close()
 inventory=json.loads((OUT/'route-inventory.json').read_text()) if (OUT/'route-inventory.json').exists() else []
 for r in inventory:
  r['status']='NOT_RUN';r['scope']='source inventory, not controls or workflow proof'
 report={'mode':'isolated mocked browser components/pages','full_backend':False,'mocked':['role/session hooks','server functions','Mitti','database via localStorage','email/SMS/Xero/Stripe (no calls)'],'counts':{s:sum(r['status']==s for r in results) for s in ['PASS','FAIL','BLOCKED']},'fixed':1,'results':results,'loaded_pages':coverage,'controls_inventory':controls,'source_routes':inventory,'external_blocked':external,'gaps':['Real authentication, RLS and two-user isolation','Office jobs dashboard/detail and quote Send/handoff','Owner acceptance/payment/ESC/deposit/install handoffs','REC/installer onboarding completion and persisted backend saves','PIESA completion/rectification/install/evidence workflows','Real Mitti/Xero/Stripe and delivery integrations','Live stale-data subscriptions; tab checks use shared local fixture only','Add-job save/address lookup not run'],'pre_fix':'failed-request check: inline alert count 0; post-fix same check count 1'}
 (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({'output':str(OUT),'counts':report['counts'],'fixed':1,'full_backend':False}));return 1 if report['counts']['FAIL'] else 0
if __name__=='__main__':
 log=(OUT/'vite.log').open('w');env={k:v for k,v in os.environ.items() if not any(x in k for x in ['SUPABASE','SECRET','TOKEN','PASSWORD','CONNECTION','API_KEY'])};server=subprocess.Popen(['bunx','--no-install','vite','--config','scripts/portal-qa-isolated.config.ts'],stdout=log,stderr=log,env=env)
 try:
  import urllib.request
  for i in range(100):
   if server.poll() is not None:raise RuntimeError('isolated port unavailable/server failed; see vite.log')
   try:
    urllib.request.urlopen(BASE+'/tests/portal-isolated/index.html',timeout=1);break
   except Exception:time.sleep(.1)
  sys.exit(asyncio.run(main()))
 finally:server.terminate();server.wait(timeout=10);log.close()
