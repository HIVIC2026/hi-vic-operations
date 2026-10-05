# Page-by-page walkthrough

Run 2 (after fixes), TEST data only, phone 390px and desktop 1280px. Screenshots: `walkthrough-screenshots.zip` in Files (file name = role_width_route).

Roles: stranger, owner on no-login link, owner signed in, installer boss (Alpha), installer worker (Alpha), electrician boss (Delta), unassigned approved partner (Bravo), office admin.

Not covered: electrician worker (no TEST account exists yet). Primary end-to-end actions: see bottom.

| Route | Role | 390 | 1280 | Ended at | Console errors | Notes |

Totals: 912 page checks — OK 871, Remove? 32, Check 9

|---|---|---|---|---|---|---|
| `/admin` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/ap-queue` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/businesses` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/campaign-emails` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/communications` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/compliance` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/coverage` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/electrician-rates` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/enquiry-groups` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/hot-leads` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/interests` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/jobs/6cee25ea-60d1-47dd-8a6c-a66b95b367cd` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/launch-campaign` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/list` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/money` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/needs-me` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/partners-overview` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/partners` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/pipeline` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/pricing` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/team-ups` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/test-centre` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/today` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/todo` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/users` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/veec` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/workers` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/owner-paperwork` | stranger | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/field` | stranger | OK | OK | `/auth` | 0 |  |
| `/field/63c7608b-dac1-45ae-a001-c92982db2621` | stranger | OK | OK | `/auth` | 0 |  |
| `/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5` | stranger | OK | OK | `/auth` | 0 |  |
| `/home` | stranger | OK | OK | `/auth` | 0 |  |
| `/owner` | stranger | OK | OK | `/auth` | 0 |  |
| `/owner/d7aada04-42f5-41ba-9cc3-381a81cd93f3` | stranger | OK | OK | `/auth` | 0 |  |
| `/partner` | stranger | OK | OK | `/auth` | 0 |  |
| `/partner/add` | stranger | OK | OK | `/auth` | 0 |  |
| `/partner/bulk-import` | stranger | OK | OK | `/auth` | 0 |  |
| `/partner/import` | stranger | OK | OK | `/auth` | 0 |  |
| `/partner/payments` | stranger | OK | OK | `/auth` | 0 |  |
| `/partner/profile` | stranger | OK | OK | `/auth` | 0 |  |
| `/partner/workers` | stranger | OK | OK | `/auth` | 0 |  |
| `/` | stranger | OK | OK | `/` | 0 |  |
| `/auth` | stranger | OK | OK | `/auth` | 0 |  |
| `/calculator` | stranger | OK | OK | `/calculator` | 0 |  |
| `/campaign-preview` | stranger | Remove? | Remove? | `/campaign-preview` | 0 | internal preview open to everyone |
| `/electrician-onboarding` | stranger | OK | OK | `/electrician-onboarding` | 0 |  |
| `/installer-onboarding` | stranger | OK | OK | `/installer-onboarding` | 0 |  |
| `/eligibility/notarealtoken000000000000000000` | stranger | OK | OK | `/eligibility/notarealtoken0000` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | stranger | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | stranger | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | stranger | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/qa-access` | stranger | OK | OK | `/qa-access?next=%2Fhome` | 0 |  |
| `/reset-password` | stranger | OK | OK | `/reset-password` | 0 |  |
| `/step3-email-preview` | stranger | Remove? | Remove? | `/step3-email-preview` | 0 | internal preview open to everyone |
| `/my-job/qaOwnerScreenCheck_1f42eb62b707497fb2b377a` | stranger | OK | OK | `/my-job/qaOwnerScreenCheck_1f4` | 0 |  |
| `/join/notarealtoken000000000000000000` | stranger | OK | OK | `/join/notarealtoken00000000000` | 0 |  |
| `/w/notarealtoken000000000000000000` | stranger | OK | OK | `/w/notarealtoken00000000000000` | 0 |  |
| `/admin` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/ap-queue` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/businesses` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/campaign-emails` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/communications` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/compliance` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/coverage` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/electrician-rates` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/enquiry-groups` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/hot-leads` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/interests` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/jobs/6cee25ea-60d1-47dd-8a6c-a66b95b367cd` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/launch-campaign` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/list` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/money` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/needs-me` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/partners-overview` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/partners` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/pipeline` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/pricing` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/team-ups` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/test-centre` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/today` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/todo` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/users` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/veec` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/workers` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/admin/owner-paperwork` | link_owner | OK (bounced) | OK (bounced) | `/auth` | 0 |  |
| `/field` | link_owner | OK | OK | `/auth` | 0 |  |
| `/field/63c7608b-dac1-45ae-a001-c92982db2621` | link_owner | OK | OK | `/auth` | 0 |  |
| `/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5` | link_owner | OK | OK | `/auth` | 0 |  |
| `/home` | link_owner | OK | OK | `/auth` | 0 |  |
| `/owner` | link_owner | OK | OK | `/auth` | 0 |  |
| `/owner/d7aada04-42f5-41ba-9cc3-381a81cd93f3` | link_owner | OK | OK | `/auth` | 0 |  |
| `/partner` | link_owner | OK | OK | `/auth` | 0 |  |
| `/partner/add` | link_owner | OK | OK | `/auth` | 0 |  |
| `/partner/bulk-import` | link_owner | OK | OK | `/auth` | 0 |  |
| `/partner/import` | link_owner | OK | OK | `/auth` | 0 |  |
| `/partner/payments` | link_owner | OK | OK | `/auth` | 0 |  |
| `/partner/profile` | link_owner | OK | OK | `/auth` | 0 |  |
| `/partner/workers` | link_owner | OK | OK | `/auth` | 0 |  |
| `/` | link_owner | OK | OK | `/` | 0 |  |
| `/auth` | link_owner | OK | OK | `/auth` | 0 |  |
| `/calculator` | link_owner | OK | OK | `/calculator` | 0 |  |
| `/campaign-preview` | link_owner | Remove? | Remove? | `/campaign-preview` | 0 | internal preview open to everyone |
| `/electrician-onboarding` | link_owner | OK | OK | `/electrician-onboarding` | 0 |  |
| `/installer-onboarding` | link_owner | OK | OK | `/installer-onboarding` | 0 |  |
| `/eligibility/notarealtoken000000000000000000` | link_owner | OK | OK | `/eligibility/notarealtoken0000` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | link_owner | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | link_owner | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | link_owner | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/qa-access` | link_owner | OK | OK | `/qa-access?next=%2Fhome` | 0 |  |
| `/reset-password` | link_owner | OK | OK | `/reset-password` | 0 |  |
| `/step3-email-preview` | link_owner | Remove? | Remove? | `/step3-email-preview` | 0 | internal preview open to everyone |
| `/my-job/qaOwnerScreenCheck_1f42eb62b707497fb2b377a` | link_owner | OK | OK | `/my-job/qaOwnerScreenCheck_1f4` | 0 |  |
| `/join/notarealtoken000000000000000000` | link_owner | OK | OK | `/join/notarealtoken00000000000` | 0 |  |
| `/w/notarealtoken000000000000000000` | link_owner | OK | OK | `/w/notarealtoken00000000000000` | 0 |  |
| `/admin` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/ap-queue` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/businesses` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/campaign-emails` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/communications` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/compliance` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/coverage` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/electrician-rates` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/enquiry-groups` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/hot-leads` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/interests` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/jobs/6cee25ea-60d1-47dd-8a6c-a66b95b367cd` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/launch-campaign` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/list` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/money` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/needs-me` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/partners-overview` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/partners` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/pipeline` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/pricing` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/team-ups` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/test-centre` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/today` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/todo` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/users` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/veec` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/workers` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/admin/owner-paperwork` | owner_signed | OK (bounced) | OK (bounced) | `/owner` | 0 |  |
| `/field` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/field/63c7608b-dac1-45ae-a001-c92982db2621` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/home` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/owner` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/owner/d7aada04-42f5-41ba-9cc3-381a81cd93f3` | owner_signed | OK | OK | `/owner/d7aada04-42f5-41ba-9cc3` | 0 |  |
| `/partner` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/partner/add` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/partner/bulk-import` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/partner/import` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/partner/payments` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/partner/profile` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/partner/workers` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/` | owner_signed | OK | OK | `/` | 0 |  |
| `/auth` | owner_signed | OK | OK | `/owner` | 0 |  |
| `/calculator` | owner_signed | OK | OK | `/calculator` | 0 |  |
| `/campaign-preview` | owner_signed | Remove? | Remove? | `/campaign-preview` | 0 | internal preview open to everyone |
| `/electrician-onboarding` | owner_signed | OK | OK | `/electrician-onboarding` | 0 |  |
| `/installer-onboarding` | owner_signed | OK | OK | `/installer-onboarding` | 0 |  |
| `/eligibility/notarealtoken000000000000000000` | owner_signed | OK | OK | `/eligibility/notarealtoken0000` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | owner_signed | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | owner_signed | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | owner_signed | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/qa-access` | owner_signed | OK | OK | `/qa-access?next=%2Fhome` | 0 |  |
| `/reset-password` | owner_signed | OK | OK | `/reset-password` | 0 |  |
| `/step3-email-preview` | owner_signed | Remove? | Remove? | `/step3-email-preview` | 0 | internal preview open to everyone |
| `/my-job/qaOwnerScreenCheck_1f42eb62b707497fb2b377a` | owner_signed | OK | OK | `/my-job/qaOwnerScreenCheck_1f4` | 0 |  |
| `/join/notarealtoken000000000000000000` | owner_signed | OK | OK | `/join/notarealtoken00000000000` | 0 |  |
| `/w/notarealtoken000000000000000000` | owner_signed | OK | OK | `/w/notarealtoken00000000000000` | 0 |  |
| `/admin` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/ap-queue` | installer_boss | OK (bounced) | OK (bounced) | `/home` | 0 |  |
| `/admin/businesses` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/campaign-emails` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/communications` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/compliance` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/coverage` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/electrician-rates` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/enquiry-groups` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/hot-leads` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/interests` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/jobs/6cee25ea-60d1-47dd-8a6c-a66b95b367cd` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/launch-campaign` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/list` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/money` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/needs-me` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/partners-overview` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/partners` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/pipeline` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/pricing` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/team-ups` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/test-centre` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/today` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/todo` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/users` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/veec` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/workers` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/owner-paperwork` | installer_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/field` | installer_boss | OK | OK | `/field` | 0 |  |
| `/field/63c7608b-dac1-45ae-a001-c92982db2621` | installer_boss | OK | OK | `/field/63c7608b-dac1-45ae-a001` | 0 |  |
| `/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5` | installer_boss | OK | OK | `/field/86bbf6fb-2de0-4dd6-b75d` | 0 |  |
| `/home` | installer_boss | OK (slow redirect) | OK | `/home` | 0 |  |
| `/owner` | installer_boss | OK (slow redirect) | OK | `/owner` | 0 |  |
| `/owner/d7aada04-42f5-41ba-9cc3-381a81cd93f3` | installer_boss | OK (slow redirect) | OK | `/home` | 0 |  |
| `/partner` | installer_boss | OK | OK | `/field` | 0 |  |
| `/partner/add` | installer_boss | OK (slow redirect) | OK | `/partner/add` | 0 |  |
| `/partner/bulk-import` | installer_boss | OK | OK | `/partner/bulk-import` | 0 |  |
| `/partner/import` | installer_boss | OK | OK | `/partner/import` | 0 |  |
| `/partner/payments` | installer_boss | OK | OK | `/partner/payments` | 0 |  |
| `/partner/profile` | installer_boss | OK | OK | `/partner/profile` | 0 |  |
| `/partner/workers` | installer_boss | OK | OK | `/partner/workers` | 0 |  |
| `/` | installer_boss | OK | OK | `/` | 0 |  |
| `/auth` | installer_boss | OK | OK | `/field` | 0 |  |
| `/calculator` | installer_boss | OK | OK | `/calculator` | 0 |  |
| `/campaign-preview` | installer_boss | Remove? | Remove? | `/campaign-preview` | 0 | internal preview open to everyone |
| `/electrician-onboarding` | installer_boss | OK | OK | `/electrician-onboarding` | 0 |  |
| `/installer-onboarding` | installer_boss | OK | OK | `/installer-onboarding` | 0 |  |
| `/eligibility/notarealtoken000000000000000000` | installer_boss | OK | OK | `/eligibility/notarealtoken0000` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | installer_boss | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | installer_boss | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | installer_boss | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/qa-access` | installer_boss | OK | OK | `/qa-access?next=%2Fhome` | 0 |  |
| `/reset-password` | installer_boss | OK | OK | `/reset-password` | 0 |  |
| `/step3-email-preview` | installer_boss | Remove? | Remove? | `/step3-email-preview` | 0 | internal preview open to everyone |
| `/my-job/qaOwnerScreenCheck_1f42eb62b707497fb2b377a` | installer_boss | OK | OK | `/my-job/qaOwnerScreenCheck_1f4` | 0 |  |
| `/join/notarealtoken000000000000000000` | installer_boss | OK | OK | `/join/notarealtoken00000000000` | 0 |  |
| `/w/notarealtoken000000000000000000` | installer_boss | OK | OK | `/w/notarealtoken00000000000000` | 0 |  |
| `/admin` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/ap-queue` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/businesses` | installer_worker | OK (slow redirect) | OK (bounced) | `/admin/businesses` | 0 |  |
| `/admin/campaign-emails` | installer_worker | OK (slow redirect) | OK (bounced) | `/admin/campaign-emails` | 0 |  |
| `/admin/communications` | installer_worker | OK (slow redirect) | OK (bounced) | `/admin/communications` | 0 |  |
| `/admin/compliance` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/coverage` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/electrician-rates` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/enquiry-groups` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/hot-leads` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/interests` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/jobs/6cee25ea-60d1-47dd-8a6c-a66b95b367cd` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/launch-campaign` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/list` | installer_worker | OK (slow redirect) | OK (bounced) | `/admin/list` | 0 |  |
| `/admin/money` | installer_worker | OK (slow redirect) | OK (bounced) | `/admin/money` | 0 |  |
| `/admin/needs-me` | installer_worker | OK (slow redirect) | OK (bounced) | `/admin/needs-me` | 0 |  |
| `/admin/partners-overview` | installer_worker | OK (slow redirect) | OK (bounced) | `/admin/partners-overview` | 0 |  |
| `/admin/partners` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/pipeline` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/pricing` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/team-ups` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/test-centre` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/today` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/todo` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/users` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/veec` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/workers` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/owner-paperwork` | installer_worker | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/field` | installer_worker | OK | OK | `/field` | 0 |  |
| `/field/63c7608b-dac1-45ae-a001-c92982db2621` | installer_worker | OK | OK | `/field/63c7608b-dac1-45ae-a001` | 0 |  |
| `/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5` | installer_worker | OK | OK | `/field/86bbf6fb-2de0-4dd6-b75d` | 0 |  |
| `/home` | installer_worker | OK | OK | `/field` | 0 |  |
| `/owner` | installer_worker | OK | OK | `/field` | 0 |  |
| `/owner/d7aada04-42f5-41ba-9cc3-381a81cd93f3` | installer_worker | OK | OK | `/field` | 0 |  |
| `/partner` | installer_worker | OK | OK | `/field` | 0 |  |
| `/partner/add` | installer_worker | OK | OK | `/field` | 0 |  |
| `/partner/bulk-import` | installer_worker | OK | OK | `/field` | 0 |  |
| `/partner/import` | installer_worker | OK | OK | `/field` | 0 |  |
| `/partner/payments` | installer_worker | OK | OK | `/field` | 0 |  |
| `/partner/profile` | installer_worker | OK | OK | `/field` | 0 |  |
| `/partner/workers` | installer_worker | OK | OK | `/field` | 0 |  |
| `/` | installer_worker | OK | OK | `/` | 0 |  |
| `/auth` | installer_worker | OK | OK | `/field` | 0 |  |
| `/calculator` | installer_worker | OK | OK | `/calculator` | 0 |  |
| `/campaign-preview` | installer_worker | Remove? | Remove? | `/campaign-preview` | 0 | internal preview open to everyone |
| `/electrician-onboarding` | installer_worker | OK | OK | `/electrician-onboarding` | 0 |  |
| `/installer-onboarding` | installer_worker | OK | OK | `/installer-onboarding` | 0 |  |
| `/eligibility/notarealtoken000000000000000000` | installer_worker | OK | OK | `/eligibility/notarealtoken0000` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | installer_worker | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | installer_worker | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | installer_worker | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/qa-access` | installer_worker | OK | OK | `/qa-access?next=%2Fhome` | 0 |  |
| `/reset-password` | installer_worker | OK | OK | `/reset-password` | 0 |  |
| `/step3-email-preview` | installer_worker | Remove? | Remove? | `/step3-email-preview` | 0 | internal preview open to everyone |
| `/my-job/qaOwnerScreenCheck_1f42eb62b707497fb2b377a` | installer_worker | OK | OK | `/my-job/qaOwnerScreenCheck_1f4` | 0 |  |
| `/join/notarealtoken000000000000000000` | installer_worker | OK | OK | `/join/notarealtoken00000000000` | 0 |  |
| `/w/notarealtoken000000000000000000` | installer_worker | OK | OK | `/w/notarealtoken00000000000000` | 0 |  |
| `/admin` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/ap-queue` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/businesses` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/campaign-emails` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/communications` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/compliance` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/coverage` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/electrician-rates` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/enquiry-groups` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/hot-leads` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/interests` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/jobs/6cee25ea-60d1-47dd-8a6c-a66b95b367cd` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/launch-campaign` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/list` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/money` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/needs-me` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/partners-overview` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/partners` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/pipeline` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/pricing` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/team-ups` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/test-centre` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/today` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/todo` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/users` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/veec` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/workers` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/owner-paperwork` | electrician_boss | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/field` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/field/63c7608b-dac1-45ae-a001-c92982db2621` | electrician_boss | OK | OK | `/field/63c7608b-dac1-45ae-a001` | 0 |  |
| `/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5` | electrician_boss | OK | OK | `/field/86bbf6fb-2de0-4dd6-b75d` | 0 |  |
| `/home` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/owner` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/owner/d7aada04-42f5-41ba-9cc3-381a81cd93f3` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/partner` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/partner/add` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/partner/bulk-import` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/partner/import` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/partner/payments` | electrician_boss | OK | OK | `/partner/payments` | 0 |  |
| `/partner/profile` | electrician_boss | OK | OK | `/partner/profile` | 0 |  |
| `/partner/workers` | electrician_boss | OK | OK | `/partner/workers` | 0 |  |
| `/` | electrician_boss | OK | OK | `/` | 0 |  |
| `/auth` | electrician_boss | OK | OK | `/field` | 0 |  |
| `/calculator` | electrician_boss | OK | OK | `/calculator` | 0 |  |
| `/campaign-preview` | electrician_boss | Remove? | Remove? | `/campaign-preview` | 0 | internal preview open to everyone |
| `/electrician-onboarding` | electrician_boss | OK | OK | `/electrician-onboarding` | 0 |  |
| `/installer-onboarding` | electrician_boss | OK | OK | `/installer-onboarding` | 0 |  |
| `/eligibility/notarealtoken000000000000000000` | electrician_boss | OK | OK | `/eligibility/notarealtoken0000` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | electrician_boss | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | electrician_boss | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | electrician_boss | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/qa-access` | electrician_boss | OK | OK | `/qa-access?next=%2Fhome` | 0 |  |
| `/reset-password` | electrician_boss | OK | OK | `/reset-password` | 0 |  |
| `/step3-email-preview` | electrician_boss | Remove? | Remove? | `/step3-email-preview` | 0 | internal preview open to everyone |
| `/my-job/qaOwnerScreenCheck_1f42eb62b707497fb2b377a` | electrician_boss | OK | OK | `/my-job/qaOwnerScreenCheck_1f4` | 0 |  |
| `/join/notarealtoken000000000000000000` | electrician_boss | OK | OK | `/join/notarealtoken00000000000` | 0 |  |
| `/w/notarealtoken000000000000000000` | electrician_boss | OK | OK | `/w/notarealtoken00000000000000` | 0 |  |
| `/admin` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/ap-queue` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/businesses` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/campaign-emails` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/communications` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/compliance` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/coverage` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/electrician-rates` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/enquiry-groups` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/hot-leads` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/interests` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/jobs/6cee25ea-60d1-47dd-8a6c-a66b95b367cd` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/launch-campaign` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/list` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/money` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/needs-me` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/partners-overview` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/partners` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/pipeline` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/pricing` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/team-ups` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/test-centre` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/today` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/todo` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/users` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/veec` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/workers` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/admin/owner-paperwork` | unassigned_partner | OK (bounced) | OK (bounced) | `/field` | 0 |  |
| `/field` | unassigned_partner | OK | OK | `/field` | 0 |  |
| `/field/63c7608b-dac1-45ae-a001-c92982db2621` | unassigned_partner | OK | OK | `/field/63c7608b-dac1-45ae-a001` | 0 |  |
| `/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5` | unassigned_partner | OK | OK | `/field/86bbf6fb-2de0-4dd6-b75d` | 0 |  |
| `/home` | unassigned_partner | OK | OK | `/field` | 0 |  |
| `/owner` | unassigned_partner | OK | OK | `/field` | 0 |  |
| `/owner/d7aada04-42f5-41ba-9cc3-381a81cd93f3` | unassigned_partner | OK | OK | `/field` | 0 |  |
| `/partner` | unassigned_partner | OK | OK | `/field` | 0 |  |
| `/partner/add` | unassigned_partner | OK | OK | `/partner/add` | 0 |  |
| `/partner/bulk-import` | unassigned_partner | OK | OK | `/partner/bulk-import` | 0 |  |
| `/partner/import` | unassigned_partner | OK | OK | `/partner/import` | 0 |  |
| `/partner/payments` | unassigned_partner | OK | OK | `/partner/payments` | 0 |  |
| `/partner/profile` | unassigned_partner | OK | OK | `/partner/profile` | 0 |  |
| `/partner/workers` | unassigned_partner | OK | OK | `/partner/workers` | 0 |  |
| `/` | unassigned_partner | OK | OK | `/` | 0 |  |
| `/auth` | unassigned_partner | OK | OK | `/field` | 0 |  |
| `/calculator` | unassigned_partner | OK | OK | `/calculator` | 0 |  |
| `/campaign-preview` | unassigned_partner | Remove? | Remove? | `/campaign-preview` | 0 | internal preview open to everyone |
| `/electrician-onboarding` | unassigned_partner | OK | OK | `/electrician-onboarding` | 0 |  |
| `/installer-onboarding` | unassigned_partner | OK | OK | `/installer-onboarding` | 0 |  |
| `/eligibility/notarealtoken000000000000000000` | unassigned_partner | OK | OK | `/eligibility/notarealtoken0000` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | unassigned_partner | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | unassigned_partner | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | unassigned_partner | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/qa-access` | unassigned_partner | OK | OK | `/qa-access?next=%2Fhome` | 0 |  |
| `/reset-password` | unassigned_partner | OK | OK | `/reset-password` | 0 |  |
| `/step3-email-preview` | unassigned_partner | Remove? | Remove? | `/step3-email-preview` | 0 | internal preview open to everyone |
| `/my-job/qaOwnerScreenCheck_1f42eb62b707497fb2b377a` | unassigned_partner | OK | OK | `/my-job/qaOwnerScreenCheck_1f4` | 0 |  |
| `/join/notarealtoken000000000000000000` | unassigned_partner | OK | OK | `/join/notarealtoken00000000000` | 0 |  |
| `/w/notarealtoken000000000000000000` | unassigned_partner | OK | OK | `/w/notarealtoken00000000000000` | 0 |  |
| `/admin` | admin | OK | OK | `/admin` | 0 |  |
| `/admin/ap-queue` | admin | OK | OK | `/admin/ap-queue` | 0 |  |
| `/admin/businesses` | admin | OK | Check | `/admin/businesses` | 0 | retired name: HI VIC |
| `/admin/campaign-emails` | admin | OK | OK | `/admin/campaign-emails` | 0 |  |
| `/admin/communications` | admin | OK | OK | `/admin/communications` | 0 |  |
| `/admin/compliance` | admin | OK | OK | `/admin/compliance` | 0 |  |
| `/admin/coverage` | admin | Check | Check | `/admin/coverage` | 0 | retired name: HI VIC |
| `/admin/electrician-rates` | admin | OK | OK | `/admin/electrician-rates` | 0 |  |
| `/admin/enquiry-groups` | admin | OK | Check | `/admin/enquiry-groups` | 0 | retired name: HI VIC,HI VIC,HI VIC |
| `/admin/hot-leads` | admin | OK | OK | `/admin/hot-leads` | 0 |  |
| `/admin/interests` | admin | OK | OK | `/admin/interests` | 0 |  |
| `/admin/jobs/6cee25ea-60d1-47dd-8a6c-a66b95b367cd` | admin | OK | OK | `/admin/jobs/6cee25ea-60d1-47dd` | 0 |  |
| `/admin/launch-campaign` | admin | OK | OK | `/admin/launch-campaign` | 0 |  |
| `/admin/list` | admin | OK | OK | `/admin/list` | 0 |  |
| `/admin/money` | admin | OK | OK | `/admin/money` | 0 |  |
| `/admin/needs-me` | admin | OK | OK | `/admin/needs-me` | 0 |  |
| `/admin/partners-overview` | admin | Check | Check | `/admin/partners-overview` | 0 | retired name: HI VIC |
| `/admin/partners` | admin | OK | OK | `/admin/partners` | 0 |  |
| `/admin/pipeline` | admin | OK | OK | `/admin/pipeline` | 0 |  |
| `/admin/pricing` | admin | OK | OK | `/admin/pricing` | 0 |  |
| `/admin/team-ups` | admin | OK | OK | `/admin/team-ups` | 0 |  |
| `/admin/test-centre` | admin | OK | Check | `/admin/test-centre` | 0 | retired name: HI VIC,HI VIC,HI VIC |
| `/admin/today` | admin | OK | OK | `/admin/today` | 0 |  |
| `/admin/todo` | admin | OK | OK | `/admin/todo` | 0 |  |
| `/admin/users` | admin | Check | Check | `/admin/users` | 0 | retired name: HI VIC,HI VIC,HI VIC |
| `/admin/veec` | admin | OK | OK | `/admin/veec` | 0 |  |
| `/admin/workers` | admin | OK | OK | `/admin/workers` | 0 |  |
| `/admin/owner-paperwork` | admin | OK | OK | `/admin/owner-paperwork` | 0 |  |
| `/field` | admin | OK | OK | `/field` | 0 |  |
| `/field/63c7608b-dac1-45ae-a001-c92982db2621` | admin | OK | OK | `/field/63c7608b-dac1-45ae-a001` | 0 |  |
| `/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5` | admin | OK | OK | `/field/86bbf6fb-2de0-4dd6-b75d` | 0 |  |
| `/home` | admin | OK (slow redirect) | OK | `/home` | 0 |  |
| `/owner` | admin | OK | OK | `/owner` | 0 |  |
| `/owner/d7aada04-42f5-41ba-9cc3-381a81cd93f3` | admin | OK | OK | `/owner/d7aada04-42f5-41ba-9cc3` | 0 |  |
| `/partner` | admin | OK | OK | `/field` | 0 |  |
| `/partner/add` | admin | OK | OK | `/partner/add` | 0 |  |
| `/partner/bulk-import` | admin | OK | OK | `/partner/bulk-import` | 0 |  |
| `/partner/import` | admin | OK | OK | `/partner/import` | 0 |  |
| `/partner/payments` | admin | OK | OK | `/partner/payments` | 0 |  |
| `/partner/profile` | admin | OK | OK | `/partner/profile` | 0 |  |
| `/partner/workers` | admin | OK | OK | `/partner/workers` | 0 |  |
| `/` | admin | OK | OK | `/` | 0 |  |
| `/auth` | admin | OK | OK | `/admin/needs-me` | 0 |  |
| `/calculator` | admin | OK | OK | `/calculator` | 0 |  |
| `/campaign-preview` | admin | Remove? | Remove? | `/campaign-preview` | 0 | internal preview open to everyone |
| `/electrician-onboarding` | admin | OK | OK | `/electrician-onboarding` | 0 |  |
| `/installer-onboarding` | admin | OK | OK | `/installer-onboarding` | 0 |  |
| `/eligibility/notarealtoken000000000000000000` | admin | OK | OK | `/eligibility/notarealtoken0000` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | admin | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | admin | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/estimate/HQ7LGAv9O_EdBtGj-mfxV47PIe5JU4j-QtW-3LZY` | admin | OK | OK | `/estimate/HQ7LGAv9O_EdBtGj-mfx` | 0 |  |
| `/qa-access` | admin | OK | OK | `/qa-access?next=%2Fhome` | 0 |  |
| `/reset-password` | admin | OK | OK | `/reset-password` | 0 |  |
| `/step3-email-preview` | admin | Remove? | Remove? | `/step3-email-preview` | 0 | internal preview open to everyone |
| `/my-job/qaOwnerScreenCheck_1f42eb62b707497fb2b377a` | admin | OK | OK | `/my-job/qaOwnerScreenCheck_1f4` | 0 |  |
| `/join/notarealtoken000000000000000000` | admin | OK | OK | `/join/notarealtoken00000000000` | 0 |  |
| `/w/notarealtoken000000000000000000` | admin | OK | OK | `/w/notarealtoken00000000000000` | 0 |  |

## Fixed in this walkthrough
1. Electricians, owners and workers could open office pages: they now go back to their own home.
2. Owners, workers and electricians could open installer-only Add job / bulk upload pages: now installer bosses only.
3. Non-owners could open the owner area, and owners could open the trade area: now blocked.
4. Installer "My business" listed every electrician business (including other partners): trades now see only their own linked electricians.
5. Workers saw boss-only tabs (Add job, Payments, Business) that bounced: tabs now hidden for workers.
6. A hidden failing data request blanked trade pages for a few seconds after the new access check: fixed.
7. Invite link page had no logo and an off-brand heading: fixed.
8. Trade fallback text said "call the office": now "Use Message us".

## Still open
- `/campaign-preview` and `/step3-email-preview` are open to anyone with the link (internal previews). Proposed: move behind office sign-in or delete.
- Office pages show the business name "DC Construction Solutions (HI VIC)" from the saved business record. Proposed: rename the record to "DC Construction Solutions (Home Insulation Victoria)" (needs Jo's OK).
- Trade reads of their own business record fail on the server (pre-existing row rule issue); pages fall back gracefully. Needs a database fix proven on the practice database.
- Electrician worker role: no TEST account yet, not walked.
- Primary end-to-end actions per role were not completed in this run (only Add customer form loads and fills for the installer boss). Scenarios A–F remain queued.

## Pages proposed for deletion (awaiting Jo)
- `/campaign-preview`, `/step3-email-preview` (internal previews)
- `/owner` and `/owner/$id` signed-in owner placeholders, if owners will only use the no-login link
