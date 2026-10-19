# HV-2594 — $349 Payment Status Verification

**任务性质:** 验证过程为只读（READ-ONLY verification）：未改源码、未合并、未发布、未改数据库、未触发任何业务动作。本文件与证据截图为事后提交的**文档交付物**。
**日期:** 2026-10-20 (AEDT)
**测试任务:** HV-2594 · 7 UAT Fixture Rise, Kalkallo VIC 3064
**最终判定:** `VERIFIED FIXED` —— 作用域为 **Lovable Preview**；已发布 Production 仍运行修复前构建（需手动 Publish）。

---

## 1. Latest GitHub main SHA

```
origin/main = 28765b50b64a2d20ce435e0bfff3567b270c1e6b
commit      = 28765b50 "Enquiries: roll back to e5b993bf (no pagination, pre-consolidation baseline)"
```

`dd3f6673` **是** `origin/main` 的祖先（`git merge-base --is-ancestor dd3f6673 origin/main` = YES）。

## 2. Payment fix present in source: **YES**

在 `origin/main` 上的 `src/lib/payment-gate.core.ts`（232 行）：

| 导出 | 行号 |
|---|---|
| `export type SafetyCheckPayState` | 148 |
| `export type SafetyCheckPayInput` | 155 |
| `export function safetyCheckPayState(...)` | 173 |
| `export function safetyCheckPayLabel(...)` | 185 |
| `export function safetyCheckPayNote(...)` | 196 |

配套改动同样在位：`src/lib/job-status.core.ts` 有 4 处 `safetyPay` 引用；`src/components/portal/panels.tsx` 有 `safety-check-payment-override` 提示条。

优先级（源码）：`paid>=required` → `recordedPaidAt` → `qaSimulated` → `overrideCount>0` → unknown → unpaid。

## 3. Preview contains payment fix: **YES**（Preview 本体，用户截图证实）；**NO**（已发布 Production）

| 目标 | HTTP | 版本判定 |
|---|---|---|
| Lovable Preview `preview--hi-vic-operations.lovable.app`（用户已认证会话截图） | 200（需会话 cookie；curl 401） | **YES — 确认含 `dd3f6673`** |
| Lovable Preview `id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app`（curl） | **401 "Unauthorized"** | UNKNOWN — 边缘层会话口令保护，curl 无法通过 |
| 已发布 host `estimate.homeinsulationvictoria.com.au` | 200 | **NO — 确认早于 `dd3f6673`** |

**Preview 运行修复版的判定依据（两个"修复版独有"字符串同时出现）：**

| 字符串 | 引入 commit | 电工侧截图 | Office 侧截图 |
|---|---|---|---|
| `TEST payment (simulated)`（`safetyCheckPayLabel` 的 `test_simulated` 分支，`payment-gate.core.ts:189`） | `dd3f6673` | **有** | — |
| `Payment block overridden — the safety check payment has not been received…`（`data-testid="safety-check-payment-override"`，`panels.tsx:419`） | `dd3f6673` | — | **有** |

两个字符串均由 `git log -S` 证实**仅**由 `dd3f6673` 引入，在修复前的 baseline 中不存在。Preview 截图同时出现二者 → **Preview 正在运行含本修复的构建**。同一任务在已发布 Production 上对应文案为 "$349 paid"（无覆盖提示条）→ Production 未更新。

**chunk 级证据（Production 陈旧）：**（同一压缩器、同一 chunk 路径、内容哈希不同）

| 字符串 | 部署 chunk `field._jobId-DZ1WnFQ_.js` (34,162 B) | 合并版构建 `field._jobId-CSjtllAV.js` (37,371 B) |
|---|---|---|
| `cannot be in the future`（Fix #2 守卫） | **0** | **1** |
| `isn't invited yet` | 1 | 1 |
| `Complete PIESA` | 1 | 1 |

仅合并版构建含 Fix #2 的日期守卫字符串 → **运行中的部署构建早于本次合并**。
证据文件：`docs/phase1/release/evidence/p0-s64-browser/`（含两个 chunk 原件）。

## 4. Electrician payment status（HV-2594，`external_mitti_id = null`）

**已发布 Production（我的认证浏览器复现）** — 真实登录 `/auth` → `/field` → `/field/42fcec2e-4f2d-4e84-b437-3a6c40e02965`：

- 时间线显示 "**$349 paid**"
- `Safety check · Expected Mon 19 Oct`
- "Safety check — **Safety check complete.**"
- "PIESA ELECTRICAL SAFETY VISIT" 联系区块
- **未出现** "Your Mitti account isn't invited yet"
- `input[type=date]` 数量 = 0（PIESA 已完成 → locked，符合预期）
- 模拟支付指示器：**无**；支付覆盖指示器：**无**

截图：`docs/phase1/release/evidence/p0-s64-browser/03-field-page.png`

**Lovable Preview（用户认证会话截图）** — 同一任务 `/field/42fcec2e-…` 的 "WHERE IT'S UP TO" 区块：

```
Ready Check                     Expected Tue 20 Oct
Quote accepted                  Mon 19 Oct
TEST payment (simulated)        ← 无日期、未勾选
Safety check                    Expected Mon 19 Oct
Electrical fixes (if any)
Fix costs paid                  Not needed
50% at install booking
Install / Final 50% / Checked by Home Insulation Victoria / Paid to you
```

- 该行文案为 "**TEST payment (simulated)**"，**无日期、未勾选** —— 与 `safetyCheckPayLabel(test_simulated)` + `done: kind==="paid" ? safetyPaidAt : null` 的推导完全一致
- **"$349 paid" 已不再出现**（这正是本修复的目的：该字符串原是硬编码常量，与支付事实无关）
- 模拟支付指示器：**有**（"TEST payment (simulated)"）
- 支付覆盖指示器：时间线行无（覆盖信息由 Office 侧承担）

## 5. Office payment status（同一任务）

**Lovable Preview（用户认证会话截图）** — `/admin/jobs/42fcec2e-…` 展开 "Xero invoice & payments"（Invoice ORC1083）：

- "Safety check payment **$349.00** **Not paid**"
- "**Payment block overridden** — the safety check payment has not been received. The job is allowed to proceed on the office's recorded override."
- "Paid to date **$0.00**" / "Remaining balance $3,178.00" / "Total accepted price (inc GST) $3,178.00" / 标签 "Deposit due"
- "⚠ Safety check can't be booked — $349.00 safety check payment not received."
- "Override by Admin on 19 Oct, 6:05 am: **TEST UAT only**: safety check payment simulated on the Xero Demo tenant (no real money, no real customer)."
- "Balance (two halves) $1,414.50 install booked · $1,414.50 install day"
- Xero 镜像：invoice ID `45c9ba3f-bcb1-49c0-8f43-963716494e00`、status `AUTHORISED`、Last sync 19 Oct 6:00 am、Reference `Home Insulation Victoria HV-2594`
- 按钮：`Sync with Xero` / `Mark deposit request raised` / `Override safety check payment block`（**均未点击**，只读）
- 模拟支付指示器：**有**（override 原因原文 "safety check payment simulated on the Xero Demo tenant (no real money…)"）
- 支付覆盖信息：**有**（override 提示条 + by Admin 时间与原因）

**已发布 Production（我的认证浏览器复现，早于修复）：**

- "**Approved payment option not yet verified**"
- "Install by 21 Nov 2026 (**PIESA +30 days**)" / "PIESA 22 Oct 2026 · install by 21 Nov 2026"
- 展开 "Quotes & payments" 后：
  - "Safety check payment **$349.00** before PIESA · balance in two halves … or paid in full"
  - "**$349.00 Not paid**"
  - "**Paid to date $0.00**"
  - "⚠ **Safety check can't be booked — $349.00 safety check payment not received.**"
  - "**Deposit due**"
  - "Override by Admin on 18 Oct: TEST UAT only: safety check payment simulated on the Xero Demo tenant (no real money, no real customer…)"
  - "Approve" 按钮：未点击（只读）
- 模拟支付指示器：**无**（仅在 override 说明文字中间接提及）
- 支付覆盖信息：**有** — override 原因 + before/after 状态

截图：`docs/phase1/release/evidence/p0-s64-browser/10-office-payments.png`、`09-office-job.png`

## 6. Are the two displays consistent? **YES**（Preview）；**NO**（已发布 Production）

| 侧 | Preview（修复版） | Production（修复前） |
|---|---|---|
| Electrician | "**TEST payment (simulated)**"（未勾选、无日期） | "**$349 paid**" |
| Office | "**$349.00 Not paid**" / "Paid to date $0.00" / "**Payment block overridden — … has not been received**" / "TEST UAT only … simulated … (no real money, no real customer)" | "$349.00 Not paid" / "Paid to date $0.00" / "payment not received"（无覆盖提示条） |

**Preview 上两侧现在一致：都不声称收到真实款项。** 电工侧明确标注这是 TEST 模拟支付且未勾选/无日期；Office 侧说明金额未收、并解释为何仍可推进（office 记录的 override，原因是 TEST UAT 模拟）。真实状态（`total_paid = 0`，无 `deposit_paid_at`）在两侧都被正确表达。

**Production 上仍不一致**，根因（已定位到代码）：`dd3f6673` 之前的 `src/lib/job-status.core.ts` 中，该时间线行的 label 是**硬编码常量**：

```ts
// 修复前（baseline 211a9bf5）
{ key: "safety_paid", label: f.staff ? "Safety check paid" : "$349 paid", done: f.safetyPaidAt, expected: null }
```

label **不随支付状态变化**；只有 `done` 勾选态依赖 `safetyPaidAt`。也就是说电工侧的 "$349 paid" 根本不是从支付事实推导出来的，而是一句静态文案 —— 所以它与 Office 的 "Not paid" 之间不是"两个 portal 对同一事实有不同判断"，而是**一个 portal 根本不做判断**。

## 7. Is TEST payment correctly distinguished from actual money received? **YES**（Preview）；**NO**（已发布 Production）

只读查得该任务的支付事实（admin 会话，未做任何写入）：

| 表 / 事件 | 读取结果 |
|---|---|
| `payment_overrides` | 1 行：`gate='deposit'`，`before_state = {total_paid: 0, deposit_gate: locked, invoice_status: deposit_due, deposit_paid_at: null}`，`after_state = {total_paid: 0, deposit_gate: overridden, invoice_status: deposit_due, deposit_paid_at: null}`，`created_at 2026-10-18T19:05:51Z` |
| `workflow_events` `qa_payment_simulated` | 1 条，`2026-10-18T19:03:18Z`："TEST only: payment simulated (no Xero, no money)" |
| `workflow_events` `payment_override` | 1 条，`2026-10-18T19:05:52Z`："Deposit gate overridden by admin: TEST UAT only…" |
| `assessment_payments` | **`[]`（空）** — 不存在 legacy 预评估已付行 |
| `invoices` | REST 对 `authenticated` 角色 `permission denied`；但 UI 显示 "Paid to date $0.00"，与 `after_state.total_paid = 0` 一致 |

### A–E 分类（HV-2594 当前事实）

| 分类 | 结论 | 依据 |
|---|---|---|
| **A. Real payment received** | **否** | `total_paid = 0`、`deposit_paid_at = null`（override before/after 状态均为 0） |
| **B. TEST simulated payment** | **是** | `qa_payment_simulated` 事件 + override 原因 "no real money" |
| **C. Administrative override** | **是** | `payment_overrides` 行（gate=deposit）+ `payment_override` 事件 |
| **D. Payment not received** | **是**（真实状态） | 同上 |
| **E. Payment status unknown** | 否 | 事实可查，非 unknown |

**关键判定：该任务的 $349 是 TEST 模拟 + 管理覆盖，实际未收款。** Office 侧的 "Not paid / not received" 在事实层面是**正确**的；电工侧的 "$349 paid" 在事实层面是**错误**的（且是静态文案，非数据推导）。

**因此：一个 TEST 模拟支付在当前运行版本中确实被电工侧呈现为"已付款" —— 违反"TEST simulated payment must not be represented as confirmed real money received"。**

**按版本区分的关键判定：**

- **已发布 Production（修复前）**：该任务的 $349 是 TEST 模拟 + 管理覆盖，实际未收款；电工侧却显示 "$349 paid" —— **一个 TEST 模拟支付被呈现为"已付款"**，违反"TEST simulated payment must not be represented as confirmed real money received"。Office 侧的 "Not paid / not received" 在事实层面正确，但它是**唯一**做判断的一侧（电工侧 label 是静态常量，不做判断）。
- **Lovable Preview（修复版）**：电工侧改为 "TEST payment (simulated)"（未勾选、无日期），Office 侧为 "$349.00 Not paid" + 覆盖提示条 + "TEST UAT only … no real money"。**两侧均不再声称收到真实款项，TEST 模拟被明确区分。**

## 8. Screenshots

| 文件 | 内容 |
|---|---|
| `docs/phase1/release/evidence/p0-s64-browser/01-auth-page.png` | 登录页（Production） |
| `docs/phase1/release/evidence/p0-s64-browser/02-after-signin.png` | 电工登录成功（Production） |
| `docs/phase1/release/evidence/p0-s64-browser/03-field-page.png` | 电工侧 HV-2594（Production，"$349 paid"） |
| `docs/phase1/release/evidence/p0-s64-browser/09-office-job.png` | Office 侧任务页（Production） |
| `docs/phase1/release/evidence/p0-s64-browser/10-office-payments.png` | Office 侧 Quotes & payments 展开（Production，"$349.00 Not paid"） |
| `docs/phase1/release/evidence/p0-s64-browser/deployed-field._jobId-DZ1WnFQ_.js` | 部署 chunk 原件 |
| `docs/phase1/release/evidence/p0-s64-browser/mybuild-field._jobId-CSjtllAV.js` | 合并版构建 chunk 原件 |
| `docs/phase1/release/evidence/p0-s64-browser/chunk-markers.json` | chunk 标记分析 |
| 用户截图：电工侧 "WHERE IT'S UP TO"（Preview） | `docs/phase1/release/evidence/hv2594-preview/11-preview-electrician-where-its-up-to.png` — "TEST payment (simulated)" 行 |
| 用户截图：Office 侧 "Xero invoice & payments"（Preview） | `docs/phase1/release/evidence/hv2594-preview/12-preview-office-xero-invoice-payments.png` — "$349.00 Not paid" + "Payment block overridden" + "TEST UAT only" override 说明 |

（仓库内证据文件在早前任务中已提交至 `origin/main`；Preview 截图证据与本报告一并在本次提交。）

## 9. Browser console errors

| 会话 | console errors | page exceptions | failed network | HTTP ≥ 400 |
|---|---|---|---|---|
| Electrician | **0** | **0** | 1（`rectification_items` `ERR_ABORTED`，导航中止，非缺陷） | 0 |
| Office admin | **0** | **0** | **0** | **0** |

## 10. Final verdict

# VERIFIED FIXED

**范围限定：本判定针对 Lovable Preview（`preview--hi-vic-operations.lovable.app`）。已发布 Production（`estimate.homeinsulationvictoria.com.au`）被确认仍在运行修复前的构建，需一次手动 Publish 才能让该判定扩展到线上。**

**依据：**
1. 支付修复**在源码中**：`origin/main` = `28765b50` 含 `dd3f6673`（`git merge-base --is-ancestor dd3f6673 origin/main` = YES）。
2. **Preview 确认运行修复版**：用户认证会话截图同时出现两个仅由 `dd3f6673` 引入的字符串 —— 电工侧 "TEST payment (simulated)"（`payment-gate.core.ts:189`）与 Office 侧 "Payment block overridden — the safety check payment has not been received."（`panels.tsx:419`，`data-testid="safety-check-payment-override"`）。`git log -S` 证实二者在此之前不存在。
3. **两侧现已一致且事实正确**（Preview）：电工 "TEST payment (simulated)"（未勾选、无日期） vs Office "$349.00 Not paid / Paid to date $0.00 / Payment block overridden … has not been received / TEST UAT only … (no real money, no real customer)"。真实状态 `total_paid = 0`、无 `deposit_paid_at` 在两侧都被正确表达，无一侧声称收到真实款项。
4. **TEST 模拟支付已被正确区分**：电工侧不再说 "$349 paid"，而是明确标注 TEST 模拟；Office 侧保留 $349 金额并标注 Not paid 与 override 原因。
5. 数据库事实（只读）与之吻合：`payment_overrides` 1 行（gate=deposit，`after_state.total_paid = 0`）、`qa_payment_simulated` 事件、"TEST only: payment simulated (no Xero, no money)"、`assessment_payments` 为空。

**关于"$349 paid"为何从电工侧消失（用户质疑"这个区块没看到349"）：**
这是本修复的**预期结果**，不是信息丢失。修复前该时间线行的 label 是硬编码常量（`f.staff ? "Safety check paid" : "$349 paid"`），与支付事实无关；HV-2594 实际未收款（Xero `total_paid = 0`，无 `deposit_paid_at`），因此 "paid" 是错误陈述。修复后该行改为由 `safetyCheckPayState` 推导 → `test_simulated` → "TEST payment (simulated)"，且 `done` 仅在 `kind === "paid"` 时才带日期，故未勾选、无日期。$349 的**金额本身**并未消失 —— 它仍然显示在 Office 侧的发票面板（"Safety check payment $349.00 Not paid"），这是金额的正确归属位置；时间线行只承担"状态"职责。

**遗留事项（不在本任务范围内）：**
- 已发布 Production 尚未更新：`field._jobId-DZ1WnFQ_.js`（34,162 B）不含 `cannot be in the future`，而合并版构建 `field._jobId-CSjtllAV.js`（37,371 B）含 → Production 需在 Lovable 面板手动 Publish。
- Phase 1 的 $349 问题在 **Preview** 上可判定为已修复并关闭；若验收标准要求线上（Production）一致，则仍需发布后复验。

---

*验证过程为只读：未修改源码、未合并、未发布 Production、未修改任何数据库记录、未创建支付覆盖、未记录支付、未生成发票、未触发 Xero、未发送邮件、未变更任务状态、未完成 PIESA。本文件及证据截图仅为文档提交。*
