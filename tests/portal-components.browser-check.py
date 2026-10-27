import asyncio, base64, json
from PIL import Image
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:4178/tests/portal-browser.html'
OUT=Path('/tmp/browser/portal-real')
async def stitch(page, output):
  await page.evaluate('window.scrollTo(0,0)')
  width=await page.evaluate('document.documentElement.scrollWidth')
  total=await page.evaluate('document.documentElement.scrollHeight')
  viewport=await page.evaluate('window.innerHeight')
  parts=[]; y=0
  while y < total:
    await page.evaluate('(top) => window.scrollTo(0, top)', y)
    await page.wait_for_timeout(50)
    path=OUT/f'{output.stem}-{y}.png'
    await page.screenshot(path=str(path))
    parts.append((y,path))
    y += viewport
  canvas=Image.new('RGB',(width,total))
  for y,path in parts:
    image=Image.open(path).convert('RGB')
    height=min(image.height,total-y)
    canvas.paste(image.crop((0,0,width,height)),(0,y))
    path.unlink()
  canvas.save(output,optimize=True)
  await page.evaluate('window.scrollTo(0,0)')
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(headless=True)
    context=await browser.new_context(viewport={'width':1280,'height':1800})
    async def guard(route):
      if route.request.url.startswith('http://127.0.0.1:4178/'):
        await route.continue_()
      else: await route.abort()
    await context.route('**/*', guard)
    page=await context.new_page()
    errors=[]
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    await page.goto(BASE+'?page=list', wait_until='networkidle')
    rows=page.get_by_role('listitem')
    assert await rows.nth(0).get_by_text('Review required', exact=True).count()==1
    assert await rows.nth(0).get_by_text('Likely eligible', exact=True).count()==0
    assert await rows.nth(1).get_by_text('Review required', exact=True).count()==1
    assert await rows.nth(2).get_by_text('Ineligible', exact=True).count()==1
    await page.get_by_test_id('desktop-filters').get_by_label('Phase').select_option('missing')
    assert await page.get_by_text('No records match this view or its filters.', exact=False).is_visible()
    await page.get_by_role('button', name='Clear filters').click()
    assert await page.get_by_role('listitem').count() >= 4
    await page.get_by_text('Select all shown').click()
    checked=await page.locator('[role=checkbox][data-state=checked]').count()
    assert checked >= 5
    await stitch(page, OUT/'desktop-list.png')
    await page.set_viewport_size({'width':390,'height':844})
    details=page.get_by_test_id('mobile-filters')
    if await details.get_attribute('open') is not None: await details.locator('summary').click()
    await page.set_viewport_size({'width':1280,'height':1800})
    assert await page.get_by_test_id('desktop-filters').get_by_label('Search').is_visible()
    await page.set_viewport_size({'width':390,'height':844})
    await stitch(page, OUT/'mobile-list.png')

    await page.goto(BASE+'?page=detail&mode=consent', wait_until='networkidle')
    await page.get_by_text('Open answer and evidence').nth(1).click()
    await page.wait_for_function("document.activeElement?.id === 'target-intake-consent'", timeout=3000)
    assert await page.locator('#target-intake-consent').is_visible()
    assert await page.locator('#target-intake-consent').get_by_text('Owner agreed to be contacted').is_visible()
    assert await page.evaluate("document.activeElement && document.activeElement.id") == 'target-intake-consent'
    await page.get_by_role('button', name='Ready Check').click()
    draft=page.get_by_label('Draft note'); await draft.fill('Unsaved inspection note')
    await page.get_by_role('button', name='Ready Check').click(); await page.get_by_role('button', name='Ready Check').click()
    assert await draft.input_value() == 'Unsaved inspection note'
    await stitch(page, OUT/'mobile-detail.png')

    await page.set_viewport_size({'width':1280,'height':1800})
    await page.goto(BASE+'?page=detail&mode=deposit', wait_until='domcontentloaded')
    await page.get_by_role('button', name='Record deposit request').click()
    await page.wait_for_function("document.activeElement?.id === 'target-deposit-request'", timeout=3000)
    assert await page.evaluate("document.activeElement?.id === 'target-deposit-request'")
    await stitch(page, OUT/'desktop-detail.png')
    assert not errors, errors
    data={}
    for size in ('desktop','mobile'):
      images={}
      for page_name in ('list','detail'):
        raw=(OUT/f'{size}-{page_name}.png').read_bytes()
        images[page_name]={'mimeType':'image/png','base64':base64.b64encode(raw).decode()}
      data[size]={'viewport': {'width':1280 if size=='desktop' else 390,'height':1800 if size=='desktop' else 844},'fixture':'actual React components with synthetic QA-only data; external network blocked','images':images}
    Path('/dev-server/design-review/portal-brief-audit-admin-desktop.json').write_text(json.dumps(data['desktop'],separators=(',',':')))
    Path('/dev-server/design-review/portal-brief-audit-admin-mobile.json').write_text(json.dumps(data['mobile'],separators=(',',':')))
    print('PASS review/stale, duplicate ineligible, phase empty+clear/select-all, delayed deposit focus, non-base44 consent, mobile-to-desktop filters, draft preservation')
    print('screenshots',*(str(OUT/f'{s}-{p}.png') for s in ('desktop','mobile') for p in ('list','detail')))
    await browser.close()
asyncio.run(main())
