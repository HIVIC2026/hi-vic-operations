# STEP 17/32 isolated browser check (sealed fixture; never reaches a live service).
# Run: bunx vite --config vite.portal-browser.config.ts  then  python3 tests/manual-communication.browser.py
import asyncio, os, re
from playwright.async_api import async_playwright
URL = os.environ.get('MANUAL_COMMS_URL', 'http://127.0.0.1:4178/tests/manual-communication.browser.html')
SHOTS = os.environ.get('SHOTS', '/tmp/browser/manual-communication')
async def main():
  os.makedirs(SHOTS, exist_ok=True)
  async with async_playwright() as pw:
    b = await pw.chromium.launch(headless=True, **({'executable_path': os.environ['CHROMIUM']} if os.environ.get('CHROMIUM') else {}))
    for w, h in [(1280, 900), (390, 844)]:
      c = await b.new_context(viewport={'width': w, 'height': h}, permissions=['clipboard-read', 'clipboard-write'])
      p = await c.new_page(); errors = []; p.on('pageerror', lambda e: errors.append(str(e)))
      await p.goto(URL, wait_until='domcontentloaded'); exp = await p.evaluate('window.__expectedMail')
      # 1. Prepare: recipient, subject and the complete body are shown.
      await p.locator('tr[data-lead="a"]').get_by_role('button', name='Prepare email to copy').click()
      d = p.get_by_role('dialog')
      await d.get_by_text('testy.owner@example.test', exact=True).wait_for()
      await d.get_by_text(exp['subject'], exact=True).wait_for()
      # STEP 32: opening the preview creates nothing – no links yet, so placeholders and the body can't be copied.
      await d.locator('[data-links-pending]').wait_for()
      shown = await d.get_by_label('Full email body').evaluate('e => e.textContent')
      assert '[link created before sending]' in shown and 'PREVIEW_ONLY_link_issued_before_sending' not in shown, 'placeholder link visible'
      assert await d.get_by_text('How the email looks').count() == 0
      assert await d.get_by_role('button', name='Copy email body', exact=True).is_disabled() and await d.get_by_role('button', name='Copy as plain text').is_disabled()
      assert await p.evaluate('window.__prepareArgs') == [{'jobId': 'lead-a'}]
      await p.screenshot(path=f'{SHOTS}/0-preview-no-links-{w}.png')
      await d.get_by_role('button', name='Create sending links').click()
      await d.locator('[data-links-pending]').wait_for(state='detached')
      assert await p.evaluate('window.__prepareArgs') == [{'jobId': 'lead-a'}, {'jobId': 'lead-a', 'issueLinks': True}]
      assert await d.get_by_label('Full email body').evaluate('e => e.textContent') == exp['plainText']
      await d.get_by_text('Approved wording').wait_for()
      # Long links must wrap: nothing in the dialog may overflow sideways, and every copy button stays on screen.
      assert await d.evaluate('e => e.scrollWidth <= e.clientWidth + 1'), 'dialog overflows horizontally'
      for name in ['Copy recipient', 'Copy subject', 'Copy email body', 'Copy as plain text']:
        box = await d.get_by_role('button', name=name, exact=True).bounding_box()
        assert box and box['x'] >= 0 and box['x'] + box['width'] <= w + 1, (name, box)
      await p.screenshot(path=f'{SHOTS}/1-prepare-{w}.png')
      # 2. Copy subject / body (plain + formatted) – browser clipboard only, no server call, no record.
      await d.get_by_role('button', name='Copy subject').click(); await d.get_by_text('Subject copied.').wait_for()
      assert await p.evaluate('navigator.clipboard.readText()') == exp['subject']
      await d.get_by_role('button', name='Copy as plain text').click(); await d.get_by_text('Email body (plain text) copied.').wait_for()
      assert await p.evaluate('navigator.clipboard.readText()') == exp['plainText']
      # Spy on what the page puts on the clipboard (headless clipboard.read() of HTML can block).
      await p.evaluate('''() => { window.__clipWrites = []; const orig = navigator.clipboard.write.bind(navigator.clipboard);
        navigator.clipboard.write = async (items) => { for (const it of items) { const rec = { types: [...it.types] }; for (const t of it.types) rec[t] = await (await it.getType(t)).text(); window.__clipWrites.push(rec); } return orig(items); }; }''')
      await d.get_by_role('button', name='Copy email body', exact=True).click(); await d.get_by_text('Email body (formatted) copied.').wait_for()
      clip = (await p.evaluate('window.__clipWrites'))[0]
      assert set(clip['types']) == {'text/plain', 'text/html'} and 'T' * 43 in clip['text/html'] and clip['text/plain'] == exp['plainText'], clip['types']
      calls = await p.evaluate('window.__mockCalls')
      assert set(calls) == {'prepareManualEmail'}, calls
      assert await p.evaluate('window.__recorded.length') == 0
      print('PASS', w, 'prepare shows recipient/subject/full body; copy subject/body works; no send or record created')
      # 3. Separate record action with the four outcomes.
      await d.get_by_role('button', name='Record communication outcome').click()
      r = p.get_by_role('dialog'); await r.get_by_role('heading', name='Record communication outcome · HV-TEST-1').wait_for()
      for label in ['Sent manually', 'Customer contacted by phone', 'Not sent', 'Follow-up required']: await r.get_by_role('radio', name=re.compile('^' + label)).wait_for()
      rec = r.get_by_role('button', name='Record outcome'); assert await rec.is_disabled()
      await r.get_by_role('radio', name=re.compile('^Sent manually')).check()
      await r.get_by_text('Records this approved email as sent by you to').wait_for(); await rec.click()
      await r.get_by_text('Recorded “Sent manually” against HV-TEST-1').wait_for()
      first = await p.evaluate('window.__recorded[0]')
      assert first == {'jobId': 'lead-a', 'outcome': 'sent_manually', 'template': 'save_my_spot', 'subject': exp['subject'], 'body': exp['plainText']}, first
      await r.get_by_text('Recorded by Office – not sent by the portal').first.wait_for(); await r.get_by_text('From the portal · Sent', exact=True).wait_for()
      await r.get_by_role('radio', name=re.compile('^Not sent')).check(); assert await rec.is_disabled()
      await r.get_by_label('Note (required)').fill('No consent on file – will phone first'); await rec.click()
      await r.get_by_text('Recorded “Not sent” against HV-TEST-1').wait_for()
      assert await p.evaluate('window.__recorded[1]') == {'jobId': 'lead-a', 'outcome': 'not_sent', 'note': 'No consent on file – will phone first'}
      await r.get_by_text('No consent on file – will phone first', exact=True).wait_for()
      await p.screenshot(path=f'{SHOTS}/2-record-{w}.png')
      print('PASS', w, 'record outcome: Sent manually stores the approved email; Not sent needs a note; history labels manual vs portal')
      await p.keyboard.press('Escape')
      # 4. Group B lead: no wording offered and "Sent manually" cannot be recorded.
      await p.locator('tr[data-lead="b"]').get_by_role('button', name='Prepare email to copy').click()
      d = p.get_by_role('dialog'); await d.get_by_text('No email to copy.').wait_for(); await d.get_by_text('Group B insulation-details wording is not approved', exact=False).wait_for()
      assert await d.get_by_role('button', name='Copy subject').count() == 0 and await d.get_by_label('Full email body').count() == 0
      await p.screenshot(path=f'{SHOTS}/3-groupb-{w}.png')
      await d.get_by_role('button', name='Record communication outcome').click()
      r = p.get_by_role('dialog'); await r.get_by_role('radio', name=re.compile('^Sent manually')).check()
      await r.get_by_text('none is available for this lead', exact=False).wait_for(); assert await r.get_by_role('button', name='Record outcome').is_disabled()
      print('PASS', w, 'Group B wording unavailable; Sent manually blocked')
      await p.keyboard.press('Escape')
      # 5. Missing ceiling size: internal estimate on the labelled 150 m² assumption; nothing to copy.
      row_c = p.locator('tr[data-lead="c"]')
      await row_c.locator('[data-manual-note="followup_pending"]').filter(has_text='Next action: follow-up pending').wait_for()
      await row_c.get_by_role('button', name='Prepare email to copy').click()
      d = p.get_by_role('dialog'); await d.get_by_text('No email to copy.').wait_for()
      est = d.locator('[data-internal-estimate]'); await est.wait_for()
      await est.get_by_text('Assumed size – not verified').wait_for()
      await est.get_by_text('Assumed size: 150 m² (typical Victorian home) – not measured and not provided by the owner').wait_for()
      await est.get_by_text('office use only', exact=False).first.wait_for()
      assert await d.get_by_role('button', name='Copy subject').count() == 0 and await d.get_by_label('Full email body').count() == 0
      assert await d.evaluate('e => e.scrollWidth <= e.clientWidth + 1'), 'dialog overflows horizontally'
      await p.screenshot(path=f'{SHOTS}/4-missing-size-{w}.png')
      print('PASS', w, 'missing size: internal 150 m² estimate labelled as an assumption; no email to copy; follow-up shown as pending')
      if w == 390: assert await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'horizontal overflow'
      assert not errors, errors; await c.close()
    await b.close()
asyncio.run(main())
