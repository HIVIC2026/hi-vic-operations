# Installer screens towards 1 second: design

Date: 31 Oct 2026 · Owner: Jo · Status: waiting for Jo's approval
Evidence: `2026-10-31-installer-one-second-findings.md` (code trace) and the live cold-load timeline of 31 Oct.

## Where the 9.7 s goes today (4G, nothing saved on the phone)

| Part | Time | Why |
|---|---|---|
| Page starts arriving | ~2.3 s | Not our code: the server does no work for this page. Most likely the hosting waking up. To be measured first. |
| App download | ~5 s | 150 files. The installer home pulls in email, official-forms and onboarding code just to get a few words and one number. The download only starts after a sign-in check. |
| Job list | ~2.5 s | It only starts after the page has drawn. Each call first checks sign-in 2–3 times in a row. Then about 45–50 database reads, about 8–10 waits in a row. |

## Goal

The installer home, one job, the Ready Check / install day screen, business and money pages show in **about 1 second** for daily use on 4G (app already on the phone). The very first open on a new phone gets as fast as we can make it. Return visits stay instant.

Speed only. No change to what anyone sees, can do, or is allowed to see.

## The fixes, in order

1. **Start the job list at the same time as the page download**, not after it. Also check sign-in from the phone's saved session for screen-only checks; every server call still checks properly. *About 1.5–2.5 s.*
2. **Stop pulling unneeded code into installer screens.** Move the few words and numbers they need into one small file. *About 0.3–0.8 s on first open.*
3. **Fonts don't hold up the start.** *About 0.3–0.6 s.*
4. **Fewer sign-in checks per server call.** Skip the TEST-office check's database read for everyone who isn't the TEST office login. Check the sign-in token on the server without another trip, if the Supabase key setup allows it. *About 0.25–0.5 s on every screen, office too.*
5. **Measure the page start** (hosting wake-up vs a slow layer). If it's wake-up, serve the empty page shell ready-made. *Up to 1–1.5 s.* This is a hosting change, so it gets Jo's OK separately.
6. **One database read for the installer home** instead of about 45, with the money strip loaded after the jobs. *About 1–1.4 s.* This is a live database change, so it gets Jo's OK before it runs.

Steps 1–4 are plain code changes. Steps 5–6 come after, each with its own yes from Jo.

## Safety and proof

- Same-information check (`installer-speed-capture --compare`) before every publish.
- Staff are still refused owner-only data. Every server call still checks access itself.
- Timing tool before and after each step, plus a "daily use" timing with the app already on the phone.
- Full TEST journey before publishing.
