# P1-R1 P0 — S64 集成、Phase 1 缺陷修复、合并 main、验证

**日期:** 2026-10-20 (AEDT)
**分支:** `integration/s64-fixes-main` → `origin/main`
**最终 origin/main:** `593d3a53`（功能提交 `dd3f6673` + 报告/证据提交 `593d3a53`）
**起始 origin/main:** `211a9bf5`

---

## A. GIT

| 项目 | 值 |
|---|---|
| 起始 `origin/main` | `211a9bf5` ("Added estimated sizing Fallback") |
| 集成工作分支 | `integration/s64-fixes-main` |
| 集成提交 | `dd3f6673` |
| 最终 `origin/main` | `593d3a535e8fe317381f42f8af8ea5adfc2b1df4` |
| 功能性提交 | `dd3f6673` |
| 文档/证据提交 | `a29c61aa`、`593d3a53` |
| 推送方式 | `git push origin integration/s64-fixes-main:main`（非 force，fast-forward） |
| 推前的 ff 校验 | `git merge-base --is-ancestor origin/main HEAD` = FF-SAFE |

**main 在任务期间被其他 agent 推进 5 次**，每次都重新 rebase 并重跑校验：
`b9bd48b7 → 211a9bf5 → 6820f768 → 5c7a6855 → 052463c4 → 812dc5c1 → dd3f6673`

每次整合后均逐项核对上游改动与本任务 14 个文件是否重叠：
- `211a9bf5 → 6820f768`（Jo 邮件重写 / png-lite）：无重叠
- `6820f768 → 5c7a6855`（Office 列表服务端分页）：**`src/lib/portal.functions.ts` 有重叠** → 已确认自动合并，分页代码（`getJobListPage`/`loadJobListPage`/`enrichPipeline`，行 1356/1370/1383）与本任务日期守卫（行 228/520/587）共存
- `5c7a6855 → 052463c4`（jo-email preview art）：无重叠
- `052463c4 → 812dc5c1`（jo-email .png 后缀）：无重叠

远端确认（`git show origin/main:<file>` 逐项 grep）：
- Fix #1 `ElectricianManualResult` 在 `src/routes/_authenticated/field.$jobId.tsx` ✓
- Fix #2 `src/lib/piesa-date.core.ts` 存在且含 `PIESA_DATE_IN_FUTURE` ✓；`portal.functions.ts` 含 4 处 `piesaDateBlockers` ✓
- Fix #3 `payment-gate.core.ts` 含 `SafetyCheckPayState` ✓；`panels.tsx` 含 `safety-check-payment-override` ✓
- 两个新测试文件在 `origin/main` ✓
- 其他 agent 的 Office/Jo 邮件改动完整保留：`jo-outcome-email.core.ts`(666 行)、`jo-email-templates.core.ts`、`png-lite.core.ts`、`email-hero.core.ts`、`gen-jo-email-previews.ts`，相对旧 local main 合计 +1281 行 ✓

**改动文件（14 个）：**

| 文件 | 变更 |
|---|---|
| `src/routes/_authenticated/field.$jobId.tsx` | 重新接线手动 PIESA 表单；删除死代码 `num`/`Yn`/`Num`/`Choice`；日期输入加 `max` |
| `src/components/portal/electrician-manual-result.tsx` | 日期输入加 `max={melbourneToday()}`（唯一便利性客户端限制） |
| `src/lib/piesa-date.core.ts` | **新增** — 未来日期判定的单一服务端真源 |
| `src/lib/portal.functions.ts` | `saveAssessment` / `completeAssessment` / `recordPiesa` 强制规则；`getInvoiceInternals` 读取 `gate` |
| `src/lib/mitti.server.ts` | Mitti 同步不再因坏日期中断：丢弃 `assessed_on` + 记 review issue |
| `src/lib/payment-gate.core.ts` | **新增** `safetyCheckPayState` 显示态联合类型 |
| `src/lib/job-status.core.ts` | `StatusFacts.safetyPay` + 重新导出 |
| `src/lib/job-status.server.ts` | 批量读取 `payment_overrides`/`workflow_events`；构造 `safetyPay` |
| `src/components/portal/panels.tsx` | Office 覆盖提示条 |
| `tests/p1-s64-date-payment-regressions.test.ts` | **新增** 19 项源码不变量测试 |
| `tests/p1-s64-date-payment-rules.test.ts` | **新增** 19 项行为规则测试 |
| `tests/electrician-manual-result.test.tsx` | +3 项（max 属性 / 回显既有日期 / locked 无可编辑控件） |
| `tests/job-status-7oct.test.ts` | 适配 `safetyPay` 必填 |
| `tests/job-status-payment-dates.test.ts` | 新增 `withPay` helper，镜像 server 产出 |

---

## B. S64（Fix #1）

**根因：** `b5f7acc0`（S64 提交）本身已在 main 上，`src/components/portal/electrician-manual-result.tsx` 与 `tests/electrician-manual-result.test.tsx` 都存在 — 但**路由接线丢失**。main 上的 `src/routes/_authenticated/field.$jobId.tsx` 渲染的是 `MittiOnly(which="piesa")`，所以部署包仍旧显示 "Your Mitti account isn't invited yet"。这是**重新集成**，不是重新实现。

注意：brief 假设的路径 `src/routes/portal/field.$jobId.tsx` 是过时的，真实路径是 `src/routes/_authenticated/field.$jobId.tsx`。

**修复内容：**

```tsx
const manualPath = !a?.external_mitti_id;          // 无 Mitti 表单 → 手动通道
const canEnter = manualPath && manualResultEntry(a); // !external_mitti_id && status !== "complete"
const showManual = manualPath && (assessing || locked);
```

13 项要求逐条落实：
1. 原生手动 PIESA 表单在无 Mitti 评估链接时渲染 ✓
2. 沿用同一 `saveAssessment` / `completeAssessment` 链 ✓
3. 保留证据门（`EvidencePanel gates={["electrical"]}`）与 clearance gates ✓
4. 保留 Mitti 路径 — `assessments.external_mitti_id` 有值时 Mitti 分支仍为权威 ✓
5. 正常 `piesa_scheduled → piesa_complete` 转换（服务端 stage gate 本已允许，仅补客户端）✓
6. `next_action` = "Reconcile PIESA scope against allowance" ✓
7. `assessments` / `piesa_records` / `workflow_events` 正常创建 ✓
8. 不要求 `external_mitti_id` ✓
9–13. 完成态锁定显示、其他项目面板、计划块、完成按钮、安全检查完成提示 ✓

`MittiOnly` 仅保留给 installer Ready Check。

---

## C. DATE VALIDATION（Fix #2）

**现象：** `assessed_on = 2026-10-22` 在 `2026-10-19` 被接受。日期只能按 UTC 比较，AEDT（UTC+11）下 `2026-10-19T12:59Z` → 19 日，`13:00Z` → 20 日，跨日边界会算错。

**单一服务端规则:** `src/lib/piesa-date.core.ts`

```ts
export const PIESA_DATE_IN_FUTURE = "PIESA date cannot be in the future.";
export const PIESA_DATE_INVALID  = "Enter a valid PIESA assessment date (YYYY-MM-DD).";
piesaDateBlockers(ymd, today = melbourneToday()): string[]   // 无效 → INVALID；未来 → FUTURE；否则 []
refuseFuturePiesaDate(patch, today): { patch; issues }        // 仅丢弃冒犯的 assessed_on
```

强制点（全部服务端，无一处仅靠客户端）：
- `saveAssessment` — 任何写入前
- `completeAssessment` — missing-fields 检查之后（防御纵深：旧数据也无法带未来日期完成）
- `recordPiesa` — 替换原 inline `> melbourneToday()` 比较与硬编码字符串
- Mitti 同步路径 — **不再中断**：丢弃 `assessed_on`，把 issue 追加进 `mitti_validation_issues`

**约束遵守：**
- 历史记录不被自动修改 ✓
- HV-2594 已完成的 PIESA 记录未被改动 ✓（未对该记录执行任何写操作）
- HV-2594 的 `assessed_on = 2026-10-22` 与 `assessed_on` 相关 fixture 不一致已在 Brief W 报告 §11.2 记录，未改数据
- 客户端 `max={melbourneToday()}` 仅为便利，规则在服务端

---

## D. PAYMENT STATUS（Fix #3）

**现象：** 电工 portal 显示 "$349 paid"，Office 显示 "$349.00 Not paid / Paid to date $0.00"。

**根因：** 两侧读取不同的真源（trade timeline 的 `safetyPaidAt` 来自 legacy TEST 预评估表 `assessment_payments`；Office mirror 读 `invoices.total_paid` vs `deposit_amount`），措辞各自为政。

**修复：** 显示态联合类型（display-only，不改变任何门判定）：

```ts
type SafetyCheckPayState =
  | { kind: "paid"; paidAt: string | null }          // 款项实际收到
  | { kind: "overridden"; at: string | null }        // 管理性覆盖
  | { kind: "test_simulated" }                        // 模拟 TEST 支付
  | { kind: "unpaid" }                               // 未收到
  | { kind: "unknown" }                              // 无法确认
```

优先级：实际款项 → 记录在册的 paid 行 → TEST 模拟 → 覆盖 → unknown → unpaid。
`safetyCheckPayLabel(state, staff)` / `safetyCheckPayNote(...)` 让两个 portal **由构造保证一致**，而不是硬编码历史解释。Office 侧新增显式覆盖提示："Payment block overridden — the safety check payment has not been received."

**`evaluatePaymentGate` 一行未动** — 合规门没有被弱化。

按用户指示，未对 HV-2594 的历史支付行做任何写操作（相关表 `payment_overrides` / `assessment_payments` / `invoices` 对所有 REST 会话均被 RLS 隐藏，只能读到 `[]`，因此修复采用"由构造保证一致"而非猜测历史事实）。

---

## E. TESTS

| 项目 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | **干净**（exit 0，无输出） |
| 生产构建 `bun run build` | **干净**（`✓ built`，exit 0） |
| 新增测试 | 49 项（19 源码不变量 + 19 行为规则 + 11→11 组件测试含 +3） |
| 目标套件（116 文件） | **1278 pass / 31 fail** |
| pristine `origin/main` 基线（同 116 文件） | **1240 pass / 31 fail** |
| 失败集合对比（`comm` 双向 diff） | **空** — 零回归，+38 项新通过 |
| rebase 到 `5c7a6855` 后重点回归 | `office-list-pagination` 29/0、`office-list-server-paging` 16/0、`admin-pipeline-visibility` 5/0、`jo-reviewed-insulation-wording` 2/0、`office-final-uat` 9/0、本任务 5 个文件 61/0 — 合计 **122 pass / 0 fail** |

未把任何失败标记为 "pre-existing" 而不附证据 — 31 项失败已用 pristine `origin/main` baseline worktree 逐字节比对，确认与本分支完全同一集合。

---

## F. PREVIEW / BROWSER VERIFICATION

工具：真实 Google Chrome 155（headless，CDP 驱动，`--no-sandbox`），**所有页面均通过真实登录表单完成认证**，非公开 401 URL。
证据目录：`docs/phase1/release/evidence/p0-s64-browser/`

### F.1 目标可达性

| 目标 | 结果 |
|---|---|
| Lovable Preview `id-preview--fb35adfe-…lovable.app`（含 `/`、 `/portal`、`/auth`、`/assets/…`） | **全部 HTTP 401 "Unauthorized"** — 边缘层预览口令保护 |
| 已发布 host `estimate.homeinsulationvictoria.com.au`（`hi-vic-operations.lovable.app` 的 302 目标） | 可达，用于认证浏览器验证 |

Preview 口令不在仓库、`.env` 或历史记录中，故 Preview 本体仍无法访问。

### F.2 电工会话（`qa.rec.delta@hivic-test.example`）— HV-2594，`external_mitti_id = null`

- 真实登录 `/auth` → 落到 `/field`，`data-login-error` 为空
- `/field/42fcec2e-4f2d-4e84-b437-3a6c40e02965` 渲染：
  - 时间线 "**$349 paid**"、`Safety check · Expected Mon 19 Oct`
  - "Safety check — **Safety check complete.**"
  - "PIESA ELECTRICAL SAFETY VISIT" 联系区块
  - **未出现** "Your Mitti account isn't invited yet"
- `input[type=date]` 数量 = **0**（该任务 PIESA 已完成 →  locked，无可用日期输入框，符合预期）
- Console 错误 **0**，页面异常 **0**，失败请求 1（`rectification_items` `ERR_ABORTED`，导航中止所致，非缺陷）
- 截图：`03-field-page.png`

### F.3 Office 会话（`admin@hivic.test`）— 同一任务

- 真实登录 → `/admin/needs-me`
- `/admin/jobs/42fcec2e-…` 正常渲染 HV-2594：
  - "**Approved payment option not yet verified**"
  - "Install by 21 Nov 2026 (**PIESA +30 days**)" / "PIESA 22 Oct 2026 · install by 21 Nov 2026" — 即由 `assessed_on = 2026-10-22`（未来日期）推出的 30 天期限，历史记录按约定保留
  - 展开 "Quotes & payments" 后：`$349.00` / "**$349.00 Not paid**" / "Paid to date $0.00" /
    "⚠ Safety check can't be booked — $349.00 safety check payment not received." /
    "Override by Admin on 19 Oct, 6:05 am: TEST UAT only: safety check payment simulated on the Xero Demo tenant (no real money, no real customer…)"
- Console 错误 **0**，页面异常 **0**，失败请求 **0**，HTTP ≥400 **0**
- 截图：`09-office-job.png`、`10-office-payments.png`

### F.4 关键结论：发布版仍是修复前代码

| chunk | 部署版 | 我的合并构建 |
|---|---|---|
| `field._jobId-*.js` | `DZ1WnFQ_`，34,162 B | `CSjtllAV`，37,371 B |
| 含 `"cannot be in the future"`（Fix #2 字符串） | **否** | **是** |

同一压缩器、同一 chunk 路径、内容哈希不同，且仅我的构建含 Fix #2 的日期守卫字符串 → **发布构建早于本次合并**。

同时，`10-office-payments.png` 与 `03-field-page.png` 两张认证截图**当场复现了 Fix #3 的缺陷**：Office 侧 "$349.00 Not paid / Paid to date $0.00 / payment not received"，电工侧 "$349 paid"。

### F.5 Fix #3 的数据血统说明（诚实披露）

HV-2594 的支付真源确实分裂：
- `assessment_payments` 有 `status='paid'` 行 → 电工侧读到 → "$349 paid"
- `invoices.total_paid = $0`（Xero 镜像）→ Office 侧读到 → "Not paid"
- 另存在 `qa_payment_simulated` 事件与 deposit 门 override（19 Oct）

我的 `safetyCheckPayState` 在**两侧都**会咨询 `recordedPaidAt`，因此该任务两侧都会收敛到 `kind: "paid"`（电工 "…$349 paid" / 员工 "Safety check paid"）— 修复确实令两侧一致。但需说明：**这一致性依赖 legacy TEST 预评估表那一行**，而不是 Xero 镜像。若该 TEST 行被移除，电工侧会翻转为 `test_simulated`/`overridden`，而 Office 侧仍显示发票镜像状态。相关表对 REST 会话被 RLS 隐藏（返回 `[]`），故以上判定基于 UI 文案 + 事件记录，未做任何数据库写入。

## G. SAFETY

| 项 | 状态 |
|---|---|
| Production publishing | **未执行**。仓库无 `.github/`、无 wrangler/nitro deploy 配置、无任何 CI/CD 工作流、`package.json` 无 deploy 脚本。推送 main 只把代码同步进 Lovable 项目；Production 发布仍需人工在 Lovable 面板点击 Publish |
| 数据库变更 | **无任何写入**。仅做过只读 SELECT（`payment_overrides`/`assessment_payments`/`invoices` 均被 RLS 隐藏返回 `[]`）。Docker 本地栈启动尝试已中止，未创建容器 |
| HV-2594 (`42fcec2e-4f2d-4e84-b437-3a6c40e02965`) | **未 reset / 未重建**；未生成新 Xero 发票；未重复支付覆盖；未改动已完成 PIESA |
| 真实支付 | 无 |
| 客户通信 | 无 |
| 破坏性 SQL | 无 |
| 未审查迁移 | 无（无迁移文件改动） |
| 合规门 | 未被禁用（`evaluatePaymentGate` 未动） |
| service_role 暴露 | 无（未取得、未使用、未写入任何文件） |
| force push | 无 |
| 浏览器验证的副作用 | **只读**。仅导航 + 登录表单提交 + 展开折叠面板；未点击任何写操作按钮（未点 "Complete PIESA"、未点 "Override safety check payment block"、未点 "Delete job"） |
| `hi-vic-github` worktree | **未触碰**。该 worktree 的 `main` 有 32 个未提交改动（17 删 + 15 改，形态上是旧版本回退，会删除 `mitti-create-claim.core.ts` 等 T3 代码），且落后 `origin/main`。这不是我的改动，已原样保留并在本报告记录 |

---

## H. FINAL VERDICT

# MERGED TO MAIN — BROWSER VERIFICATION PENDING

**已完成（有证据）：**
- 三项修复实现、测试、合并、推送到 `origin/main`（`dd3f6673`），远端四项内容确认在位
- `tsc --noEmit` 干净，`bun run build` 干净，新增 49 项测试全通过，与 pristine 基线比对零回归
- 仓库无任何自动部署工作流；推送 main 只同步到 Lovable 项目，Production 发布需人工在 Lovable 面板点击 Publish

**浏览器验证已执行，但目标未达成：**
- 已用两个真实角色（电工、Office admin）在真实 Chrome 中完成认证会话，抓取页面文本、控制台、网络与截图 —— 零 console 错误、零页面异常、零失败请求
- 但**验证目标（含合并代码的 Lovable Preview）无法访问**：Preview host 边缘层 401，且发布版仍未包含本次合并（F.4 已用 chunk 级 diff 证明）
- 因此无法在浏览器中"看到"三项修复生效后的样子；反而当场复现了 Fix #3 的缺陷两侧文案

**要补齐预览验证，需要其中一项：**
1. Lovable Preview 边缘层口令（解锁 `id-preview--fb35adfe-…lovable.app`），或
2. 在 Lovable 面板点击 Publish 后重跑同一脚本（将显示新代码行为）

**合并不因此撤销** — brief 明确授权，并规定浏览器失败不构成跳过授权合并的理由。
## I. 提交说明

本报告本身是 `dd3f6673` 之后的纯文档提交（docs-only），不改动任何源码。任务的功能性最终状态以 `dd3f6673` 为准。
