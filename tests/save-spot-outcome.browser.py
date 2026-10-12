# STEP 56 isolated browser check (sealed fixture; never reaches a live service).
# Run: bunx vite --config vite.portal-browser.config.ts  then  python3 tests/save-spot-outcome.browser.py
import asyncio, os
from playwright.async_api import async_playwright
URL = os.environ.get('SAVE_SPOT_OUTCOME_URL', 'http://127.0.0.1:4178/tests/save-spot-outcome.browser.html')
SHOTS = os.environ.get('SHOTS', '/tmp/browser/save-spot-outcome')
async def main():
  os.makedirs(SHOTS, exist_ok=True)
  async with async_playwright() as pw:
    b = await pw.chromium.launch(headless=True, **({'executable_path': os.environ['CHROMIUM']} if os.environ.get('CHROMIUM') else {}))
    for w, h in [(1280, 900), (390, 844)]:
      c = await b.new_context(viewport={'width': w, 'height': h})
      p = await c.new_page(); errors = []; p.on('pageerror', lambda e: errors.append(str(e)))
      await p.goto(URL, wait_until='domcontentloaded')
      row = p.locator('tr[data-lead="u"]')
      await row.get_by_text('Save my spot email: outcome unknown (attempted').wait_for()
      await row.get_by_role('button', name='Resolve email outcome').click()
      d = p.get_by_role('dialog')
      await d.get_by_text('Saving here never sends anything.', exact=False).wait_for()
      await d.get_by_text('Last recorded: sent_unknown:', exact=False).wait_for()
      save = d.get_by_role('button', name='Save resolution')
      assert await save.is_disabled(), 'save enabled with nothing chosen'
      await d.get_by_label('The email service shows it was NOT delivered').check()
      assert await save.is_disabled(), 'save enabled without a note'
      await d.get_by_label('What did you check? (required)').fill('ok')
      assert await save.is_disabled(), 'save enabled with a too-short note'
      assert await d.evaluate('e => e.scrollWidth <= e.clientWidth + 1'), 'dialog overflows horizontally'
      await p.screenshot(path=f'{SHOTS}/1-dialog-{w}.png')
      # A concurrent change is shown, nothing is closed.
      await d.get_by_label('What did you check? (required)').fill('race condition check')
      await save.click(); await d.get_by_role('alert').get_by_text('changed while you were checking').wait_for()
      assert await p.evaluate('window.__done') == 0
      await d.get_by_label('What did you check? (required)').fill('Resend shows no email to this address')
      await save.click(); await d.wait_for(state='detached')
      args = await p.evaluate('window.__resolveArgs')
      assert args[-1] == {'jobId': 'lead-u', 'sendId': '00000000-0000-4000-8000-0000000005e1', 'attemptAt': '2026-10-12T00:41:00Z', 'resolution': 'not_delivered', 'note': 'Resend shows no email to this address'}, args
      assert await p.evaluate('window.__done') == 1
      calls = await p.evaluate('window.__mockCalls')
      assert set(calls) == {'resolveSaveSpotOutcome'}, calls  # the only server action used; nothing sends
      await p.screenshot(path=f'{SHOTS}/2-after-{w}.png')
      assert not errors, errors
      await c.close()
    await b.close()
  print('save-spot-outcome browser check: PASS')
asyncio.run(main())
