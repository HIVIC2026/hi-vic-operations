import asyncio, sys, json
from pathlib import Path
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; RUN=sys.argv[1]; M=json.load(open("/tmp/browser/login-signed/.m.json"))
OUT=Path(f"/tmp/browser/login-signed/run{RUN}"); OUT.mkdir(parents=True,exist_ok=True); R=[]
def rec(n,ok,i=""): R.append([n,bool(ok),i]); print("PASS" if ok else "FAIL",n,"|",i,flush=True)
async def main():
  async with async_playwright() as pw:
    b=await pw.chromium.launch(headless=True)
    async def fresh():
      c=await b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True); return c,await c.new_page()
    async def signin(p,who,path="/portal"):
      await p.goto(BASE+path); await p.wait_for_selector("#e",timeout=30000)
      await p.fill("#e",M[who]["email"]); await p.fill("#p",M[who]["pw"]); await p.get_by_role("button",name="Sign in",exact=True).click()
    async def landed(p,frag,shot,timeout=30000):
      try: await p.wait_for_url(lambda u: frag in u, timeout=timeout)
      except Exception: pass
      await p.wait_for_timeout(1500); await p.screenshot(path=str(OUT/f"{shot}.png")); return p.url
    async def step(n,fn):
      try: await fn()
      except Exception as e: rec(n,False,f"crashed: {str(e)[:160]}")
    async def land(who,frag,shot,extra=None):
      c,p=await fresh(); await signin(p,who); u=await landed(p,frag,shot)
      for _ in range(20):
        t=await p.locator("body").inner_text()
        if "Loading" not in t: break
        await p.wait_for_timeout(1000)
      await p.screenshot(path=str(OUT/f"{shot}.png"))
      ok=frag in u and "calculator" not in u.lower() and len(t.strip())>40
      if extra: ok = ok and extra(t)
      rec(f"password sign-in: {who} lands on {frag}", ok, u.replace(BASE,"")); return c,p
    async def t_office():
      c,p=await land("office","/admin/needs-me","01-office-needs-me"); await c.close()
    async def t_boss():
      c,p=await land("boss","/field","02-boss-my-work")
      await p.reload(); await p.wait_for_timeout(3000); rec("stays signed in after reload (phone)", "/field" in p.url and await p.locator("#e").count()==0, p.url.replace(BASE,""))
      p2=await c.new_page(); await p2.goto(BASE+"/field"); await p2.wait_for_timeout(4000); rec("stays signed in in a new tab", "/field" in p2.url and await p2.locator("#e").count()==0, p2.url.replace(BASE,""))
      await p2.get_by_role("button",name="Account menu").click(); await p2.get_by_role("button",name="Sign out").click(); await p2.wait_for_timeout(4000); await p2.screenshot(path=str(OUT/"03-signed-out.png"))
      await p2.goto(BASE+"/field"); await p2.wait_for_selector("#e",timeout=30000)
      rec("sign out works: /field then asks to sign in", await p2.locator("#e").count()==1, p2.url.replace(BASE,"")); await c.close()
    async def t_staff():
      c,p=await land("staff","/field","04-staff-my-work")
      await p.goto(BASE+"/owner"); await p.wait_for_timeout(5000); await p.screenshot(path=str(OUT/"05-staff-on-owner-page.png")); t=await p.locator("body").inner_text()
      rec("staff blocked from owner pages", ("/owner" not in p.url) or any(s in t for s in ["isn't linked","not linked","no access","Your account"]) , p.url.replace(BASE,"")+" | "+t[:80].replace("\n"," ")); await c.close()
    async def t_owner():
      c,p=await land("owner","/owner","06-owner-my-job"); await c.close()
    async def t_noaccess():
      c,p=await fresh(); await signin(p,"noaccess"); await p.wait_for_timeout(6000); await p.screenshot(path=str(OUT/"07-no-access.png")); t=await p.locator("body").inner_text()
      rec("no access: 'Your account isn't linked yet' with info@", "linked yet" in t and "info@homeinsulationvictoria.com.au" in t, p.url.replace(BASE,"")); await c.close()
    async def t_deeplink():
      if not M["offer"]: rec("deep link returns after sign-in", False, "no TEST offer"); return
      c,p=await fresh(); target=f"/field/offer/{M['offer']}"; await p.goto(BASE+target); await p.wait_for_selector("#e",timeout=30000)
      await p.fill("#e",M["boss"]["email"]); await p.fill("#p",M["boss"]["pw"]); await p.get_by_role("button",name="Sign in",exact=True).click()
      u=await landed(p,target,"08-deeplink-returned"); rec("deep link: logged-out /field/offer/… returns there after sign-in", target in u, u.replace(BASE,"")); await c.close()
    async def t_magic():
      c,p=await fresh(); await p.goto(M["magicBoss"]); u=await landed(p,"/field","09-magic-link-signed-in"); rec("sign-in link (magic link) signs in and lands on My work", "/field" in u, u.replace(BASE,""))
      await c.close()
      c,p=await fresh(); await p.goto(M["magicBoss"]); await p.wait_for_timeout(6000); await p.screenshot(path=str(OUT/"10-magic-link-reused.png")); t=await p.locator("body").inner_text()
      rec("same sign-in link opened again: clear 'used/expired' message", any(s in t for s in ["already used","expired","no longer valid"]) and "/field" not in p.url, t[:90].replace("\n"," ")); await c.close()
    async def t_partner():
      c,p=await fresh(); await p.goto(M["partner"].replace("https://estimate.homeinsulationvictoria.com.au",BASE)); await p.wait_for_selector("text=Set your password",timeout=30000)
      await p.wait_for_timeout(1500); inputs=p.locator("input[type=password]"); await inputs.nth(0).fill(M["boss"]["pw"]+"n"); await inputs.nth(1).fill(M["boss"]["pw"]+"n")
      await p.screenshot(path=str(OUT/"11-partner-24h-set-password.png")); await p.get_by_role("button",name="Save password & continue").click()
      u=await landed(p,"/field/welcome","12-partner-welcome")
      if "/field/welcome" not in u: print("  note:", (await p.locator("body").inner_text())[:200].replace("\n"," "))
      rec("24-hour partner link: set password → welcome page", "/field/welcome" in u, u.replace(BASE,"")); await c.close()
      c,p=await fresh(); await p.goto(M["partner"].replace("https://estimate.homeinsulationvictoria.com.au",BASE)); await p.wait_for_timeout(6000); t=await p.locator("body").inner_text(); await p.screenshot(path=str(OUT/"13-partner-link-used.png"))
      rec("24-hour partner link opened again: 'already been used' + Send me a new link", "already been used" in t and "Send me a new link" in t, t[:90].replace("\n"," ")); await c.close()
      c,p=await fresh(); await p.goto(M["expired"].replace("https://estimate.homeinsulationvictoria.com.au",BASE)); await p.wait_for_timeout(6000); t=await p.locator("body").inner_text(); await p.screenshot(path=str(OUT/"14-partner-link-expired.png"))
      rec("expired partner link: 'has expired' + Send me a new link", "has expired" in t and "Send me a new link" in t, t[:90].replace("\n"," ")); await c.close()
    async def t_reset():
      c,p=await fresh(); await p.goto(M["recoveryStaff"].replace("https://estimate.homeinsulationvictoria.com.au",BASE)); await p.wait_for_selector("text=Set your password",timeout=30000); await p.wait_for_timeout(1500)
      inputs=p.locator("input[type=password]"); await inputs.nth(0).fill(M["staff"]["pw"]+"n"); await inputs.nth(1).fill(M["staff"]["pw"]+"n"); await p.get_by_role("button",name="Save password & continue").click()
      u=await landed(p,"/field","15-reset-done"); rec("password reset link: new password saved → staff My work", "/field" in u, u.replace(BASE,"")); await c.close()
    for n,f in [("office",t_office),("boss",t_boss),("staff",t_staff),("owner",t_owner),("noaccess",t_noaccess),("deeplink",t_deeplink),("magic",t_magic),("partner",t_partner),("reset",t_reset)]: await step(n,f)
    await b.close()
  json.dump(R,open(OUT/"results.json","w"))
asyncio.run(main())
