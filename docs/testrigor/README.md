# Testing the portal with testRigor

This folder holds ready-made testRigor tests for the live portal, for four roles:
homeowner, installer, electrician and office.

| File | What it is |
| --- | --- |
| `rules.txt` | Reusable steps, like "sign in as installer" |
| `homeowner.txt` | Calculator and the owner's My job link |
| `installer.txt` | Installer screens and actions |
| `electrician.txt` | Electrician screens and actions |
| `office.txt` | Office screens and actions |
| `coverage.md` | What each test checks, and what isn't tested |

Use TEST accounts and TEST jobs only. Never real customers.

## 1. Make a testRigor account

1. Go to testrigor.com and sign up.
2. **Choose a private (paid) plan.** The free public plan publishes your tests and results for anyone to see.
   That would show TEST logins and links.

## 2. Make the test suite

1. Click **Create new test suite**.
2. Type: **Web**.
3. App URL: `https://portal.homeinsulationvictoria.com.au`
4. Leave the login fields empty. The rules in step 4 sign in for you.

Where things are:

- Staff and trades sign in at `/auth`.
- On this address, `/` also opens sign-in, not the calculator (decision 381).
- The calculator is at `/calculator` here. Customers see the same calculator at
  `https://estimate.homeinsulationvictoria.com.au/`.

## 3. Add stored values

In the suite, open **Test Data** (stored values) and add these. Type the names exactly.

| Name | What to put in it |
| --- | --- |
| `installerEmail` | `qa.installer.alpha@hivic-test.example` (or Deep's TEST installer, see below) |
| `installerPassword` | Its password |
| `electricianEmail` | `qa.rec.delta@hivic-test.example` |
| `electricianPassword` | Its password |
| `officeEmail` | `admin@hivic.test` |
| `officePassword` | Its password |
| `ownerJobLink` | The TEST job's owner link (see below) |
| `testJobNumber` | The TEST job number, like `HV-1234` |

Optional ones (some cases use them):

| Name | What to put in it |
| --- | --- |
| `ownerTurnLink` | `ownerJobLink` with `?screen=turn` on the end |
| `ownerReviewLink` | `ownerJobLink` with `?screen=review` on the end |
| `ownerFullName` | The TEST owner's name, exactly as on the job |
| `installerFullName` | The TEST installer's own name, exactly as in the portal |
| `dummyPdfUrl` | A link to a blank PDF you uploaded to testRigor |

**Passwords and links go into testRigor only.** Never put them in chat, email or this repo.

### Passwords

The TEST email addresses are not real inboxes. So **"Forgot password?" and "Email me a sign-in link" can't reach them.**

- **Office (`admin@hivic.test`)**: use the password you already have for it.
  If you don't have one, ask the developer to set one for you once.
- **Deep's TEST installer** (`installer-qa-dad-20261021@hivic-test.example`): you can set this one yourself.
  Office > More > Settings > Users & access > **Prepare Deep's TEST login (private file)**.
  Open the file, open the **Set your password** link, type a **New password** twice, press **Save password & continue**.
  You can use this account as `installerEmail`.
- **`qa.installer.alpha` and `qa.rec.delta`**: their passwords were made up by the computer and nobody knows them.
  Either ask the developer to set one once, **or** skip passwords: use the "no password" rules at the bottom of
  `rules.txt` (step 4). They sign in as office, then open a one-time TEST sign-in from the Test Centre.

### The TEST job and its owner link

1. Office > More > **Test Centre**. Each TEST journey card shows its job number (`HV-…`). Put it in `testJobNumber`.
   No TEST job yet? Run office case **O-50** (or press **Create dummy journey** yourself).
2. Press **Open journey** on that card, then the **Enquiry** card, then **Show link (admin only)**.
3. Copy the link. It ends `/estimate/<code>`. Change `/estimate/` to `/my-job/`. Put it in `ownerJobLink`.
   No **Show link** button means the owner link isn't ready yet.

## 4. Add the reusable rules

testRigor > **Reusable Rules** > **Add rule**, once for each `### RULE:` in `rules.txt`.

- Rule name: the words after `### RULE:` (for example `sign in as installer`).
- Steps: the lines under it, down to the next `### RULE:`.

No passwords for the trade accounts? Paste the steps of **sign in as installer (no password)**
into the rule called **sign in as installer**. Same for the electrician.

## 5. Paste in the test cases

For each `### ` title in the four role files:

1. **Add test case**.
2. **Description**: the title line without `###` (for example `I-01 · My work opens after sign-in   [read-only]`).
3. **Custom steps**: the lines under it, down to the next `###`.

Lines starting with `//` are notes. You can paste them or leave them out.

## 6. Run them, in this order

1. All `[read-only]` cases. They only look. Run them any time.
2. The cases that change the TEST job, in number order:
   `[CHANGES THE TEST JOB]`, `[CHANGES THE TEST BUSINESS]`, `[CREATES TEST DATA]`.
   They follow one TEST job from offer to install. The roles take turns, for example
   office **O-58** (Release) → owner **H-40** (confirm) → installer **I-40** (send times) → owner **H-41** (book).
   `coverage.md` lists the full order.
3. **Run last**: `[ONE-WAY - run last]` cases can't be undone (decline, cancel, archive).
   Make a spare TEST job first (case **O-50**). Point `testJobNumber` and `ownerJobLink` at the spare job,
   run the one-way cases, then point them back.

A line starting `// Needs:` says what state the TEST job must be in. If it isn't there yet,
the case fails at its first check. That's expected. Run it again when the job gets there.

## 7. Reading the results

- **Green** = passed. **Red** = failed.
- Click a red case. testRigor shows the step that failed and a screenshot.
- Common reasons:
  - The TEST job isn't at the right step yet (see `// Needs:`).
  - A day tile or time menu. These change every day; the steps pick "the 1st / 2nd / 3rd" one.
    Open the step in testRigor's editor and pick the tile it suggests.
  - A wording change in the portal. Tell the developer which case and step.
- testRigor screenshots can show TEST names and job numbers. That's why the plan must be private.

## 8. What testRigor can't test here

- **Mitti forms.** Mitti is a separate app. The tests only check that **Open Mitti form** is there.
- **Real emails and texts.** For TEST jobs and TEST partners, the portal only sends to your own mobile and email
  (the test allowlist); everyone else is blocked. Customer messages also stay off until you switch each type on
  in Settings > Switches. Held messages show in Communications. testRigor's own inbox isn't on the allowlist,
  so "check that email … was delivered" won't work. Check your own inbox by hand.
- **Owner sign-in codes** are fine: on TEST jobs the page shows the 6-digit code instead of sending it.
- **Card payments (Stripe)** until Stripe test keys are added. For TEST jobs, office case **O-61** records a
  TEST payment instead (no money, no Xero).
- **Xero** until the Demo Company is connected. TEST jobs only ever reach the Demo Company.
- **Photo and file uploads** need testRigor's file upload and the browser's location turned on (the portal refuses
  photos without a location). Treat those cases as "try once".
- **Things never to automate** on the live portal: Settings > Switches, Communications > Cancel these,
  Money > Mark paid, Publish new prices, approving real partner applications, and the calculator's
  **Register my interest** send button (it makes a real enquiry). The tests only check their error messages.

Full list: `coverage.md`.
