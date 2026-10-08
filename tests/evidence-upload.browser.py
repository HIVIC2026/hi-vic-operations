import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

R = Path('/tmp/browser/evidence')
R.mkdir(parents=True, exist_ok=True)
PDF = b'%PDF-1.4\nTEST evidence retry\n%%EOF'
async def choose(page, name='evidence.pdf', mime='application/pdf', buffer=PDF):
    await page.locator('input[type=file]').set_input_files({'name': name, 'mimeType': mime, 'buffer': buffer})

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        for width in [1280, 390]:
            c = await b.new_context(viewport={'width':1280,'height':1800})
            page = await c.new_page()
            if width == 390: await page.set_viewport_size({'width':390,'height':844})
            errors=[]
            page.on('pageerror', lambda e: errors.append(str(e)))
            await page.goto('http://localhost:8093/tests/evidence-upload.browser.html')
            await page.get_by_role('button', name='Add photo / video / PDF', exact=True).wait_for()
            await page.evaluate('window.__queryFails=true;window.__refresh()')
            await page.get_by_role('alert').filter(has_text='Evidence could not be loaded').wait_for()
            assert await page.get_by_text('0/0 required', exact=True).count()==0
            await page.evaluate('window.__queryFails=false')
            await page.get_by_role('button',name='Retry',exact=True).click()
            await page.get_by_role('button',name='Add photo / video / PDF',exact=True).wait_for()
            print('PASS',width,'read failure/retry, no false zero')
            await choose(page,'bad.svg','image/svg+xml',b'<svg/>')
            await page.get_by_role('alert').filter(has_text='Only photos').wait_for()
            assert await page.evaluate('window.__requestCalls')==0
            await choose(page,buffer=b'')
            await page.get_by_role('alert').filter(has_text='empty').wait_for()
            print('PASS',width,'type and empty-file errors')
            await page.evaluate('window.__storageFails=true')
            await choose(page)
            await page.get_by_role('alert').filter(has_text='size limit').wait_for()
            assert await page.locator('input[type=file]').input_value()==''
            await page.evaluate('window.__storageFails=false;window.__confirmFails=true')
            await choose(page)
            await page.get_by_role('alert').filter(has_text='not confirmed').wait_for()
            assert await page.get_by_text('Upload confirmed.',exact=False).count()==0
            n=await page.evaluate('window.__storageCalls')
            await page.evaluate('window.__confirmFails=false')
            await page.get_by_role('button',name='Retry confirmation',exact=True).click()
            await page.get_by_role('status').filter(has_text='Upload confirmed').wait_for()
            assert await page.evaluate('window.__storageCalls')==n
            print('PASS',width,'same-file retry and confirmation retry without reupload')
            await page.evaluate('window.__openFails=true')
            await page.get_by_role('button',name='evidence.pdf',exact=True).click()
            await page.get_by_role('button',name='Opening…',exact=True).wait_for()
            await page.get_by_role('alert').filter(has_text='file read unavailable').wait_for()
            await page.evaluate('window.__openFails=false')
            await page.get_by_role('button',name='evidence.pdf',exact=True).click()
            await page.get_by_role('dialog').wait_for()
            await page.screenshot(path=str(R/f'open-{width}.png'))
            await page.get_by_role('button',name='Close',exact=True).click()
            print('PASS',width,'open busy/error/retry')
            await choose(page,'photo.jpg','image/jpeg',b'\xff\xd8\xffTEST')
            await page.get_by_role('alert').filter(has_text='Allow location access').wait_for()
            assert await page.evaluate('window.__storageCalls')==n
            assert not errors, errors
            await page.screenshot(path=str(R/f'location-{width}.png'))
            print('PASS',width,'location refusal unchanged, no invented GPS; zero exceptions')
            await c.close()
        await b.close()

asyncio.run(main())