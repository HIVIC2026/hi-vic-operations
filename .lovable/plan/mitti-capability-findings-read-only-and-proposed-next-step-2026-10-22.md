# Mitti capability findings (read-only) and proposed next step

Nothing was changed in the portal or Mitti. All checks were GET calls with the existing connection.

## Findings

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Link that opens a new blank form, name pre-set | Unknown (not in our API use) | Code only creates via `POST /audits` (`mitti.core.ts` createAudit). No create-link endpoint used or found. Installers can start one in the app themselves (Deep did 4). |
| 2 | See who created it and when | Yes | `GET /audits/{id}` returns `audit_data.authorship` (author/owner name + user id, e.g. "Deep -", `user_c39f…`), `created_at`, `date_started`. User id maps to email via `POST /users/search`. Company is not on the form; the portal maps it from the email. |
| 3 | Required fields | Yes, partly | Both templates use `is_mandatory`. A1 Installer-Supplied: 181 mandatory items incl. Homeowner name, Site address, measured ceiling area, existing R-value, insulation depth, overview/access/depth photos, quoted price. A2 HIV: 147 incl. Homeowner name, Site address, measured area, access photo, signature. **Neither form has a phone, mobile or email question at all.** `mandatory_mark_as_complete` is false on both; whether Mitti hard-blocks completion was not tested. |
| 4 | Update after creation | Partly yes | Used and working: `PUT /audits/{id}` (answers/header), `PUT /inspections/v1/inspections/{id}/owner` (reassign), `POST /audits/{id}/share`. Archive/cancel and scheduled date changes: unknown, not used or tested. |
| 5 | Webhooks | Yes, available; none set up | `GET /webhooks/v1/webhooks` returns 200 with an empty list. Setup/signing method not confirmed; no signing code exists in the portal. |
| 6 | Scheduled / due date on create | Unknown | `GET /schedules/v1/schedule_items` returns 200, 0 items. The portal only writes the visit time into the "Inspection Date and Time" answer, not a real due date. |
| 7 | How installer receives a form | In their Mitti list only (as far as we know) | Code makes them owner so it "sits in THEIR Inspections list" (`mitti.core.ts` setAuditOwner). No push or email is sent by us. Whether Mitti sends its own alert: unknown. |
| 8 | Two ID formats | The same template, different formats. **Yes, pickup misses the HIV form** | Settings store `dbaf67a2-c9c5-…` (dashed). Mitti search returns `template_dbaf67a2c9c5…` (6 recent forms). `mitti-pickup.server.ts` compares exact strings, so these never match. A normaliser already exists (`mitti-identity.core.ts`) but pickup doesn't use it. |

## What this means for "type once"

- Installers can start forms themselves and we can reliably tell who and when, so Mitti-first pickup is viable.
- The forms cannot collect phone or email yet. Add those questions (and an owner-permission tick) to A1 before relying on Mitti-first.
- Name, address, area, R-value and photos are already mandatory on A1. Whether Mitti blocks completion when they're missing needs one live test.
- Webhooks exist but are not set up, so today the portal polls for changes. Webhooks could replace polling later, once signing is confirmed.
- Fix first: the pickup panel ignores every HIV-form Ready Check because of the ID format mismatch.

## Proposed next step (needs approval)

Pickup panel: compare template IDs with the existing normaliser so HIV-form Ready Checks appear. Add one test with the dashed ID and the `template_` ID. Nothing else changes, and nothing is published.
