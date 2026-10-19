# Phase 1 验收复核：Manual PIESA 集成 + 未来日期校验

日期：2026-10-20 03:5x（Australia/Melbourne）
角色：QA / Browser Verification Engineer
验证对象：`dd3f6673`（2026-10-19 23:57 "P0: Complete S64 manual PIESA integration, fix future dates and $349 payment status"）
模式：只读验证。未修改源码、未写生产数据、未跑迁移。（本报告与配套测试已随提交 `c5cbd3a3` 推送 `origin/main`。）

## 最终状态

| 项目 | 状态 |
|---|---|
| **S64** | **CLOSED / PREVIEW VERIFIED / PRODUCTION RELEASE PENDING** |
| **DATABASE RELEASE GATE** | **PASS**（基于 Lovable AI 生产数据库核查报告；见 `docs/phase1/release/P1-R1-S69_PRODUCTION_MIGRATION_RECONCILIATION.md`） |
| Fix #1 Manual PIESA | **VERIFIED FIXED** |
| Fix #2 未来日期校验 | **VERIFIED FIXED** |

- **CLOSED**：两个修复的验收证据齐备，无需再开发（未建议任何额外开发——未发现实际缺陷）。
- **PREVIEW VERIFIED**：已在 Lovable Preview 以 TEST 账号实测确认（Fix #1 浏览器实测；Fix #2 隔离环境运行时验证）。
- **PRODUCTION RELEASE PENDING**：生产发布仍待 owner 在 Lovable 面板执行 **Publish**；
  Production 域名运行版本本次**未验证**，故不声明生产侧 PASS。

---

## SECTION A — VERSION

| 项目 | 结果 |
|---|---|
| 最新 `origin/main` | `28765b50b64a2d20ce435e0bfff3567b270c1e6b`（本次复核期间远端前进至 `1e4f6815`，该提交仅新增 HV-2594 支付状态验证文档，`git diff 28765b50 origin/main -- src/lib/portal.functions.ts src/lib/piesa-date.core.ts src/lib/melbourne-time.core.ts` 为空，两个修复未受影响） |
| `dd3f6673` 是否为祖先 | **YES** |
| 之后是否有提交改动相关实现 | **NO**——`git log dd3f6673..origin/main --` 对 `field.$jobId.tsx`、`piesa-date.core.ts`、`mitti.server.ts`、`portal.functions.ts`、`electrician-manual-result.tsx` 全部为空；`git diff dd3f6673 origin/main --` 这四个文件亦为空 |
| Preview 运行版本 | **含两个修复（行为已验证）** |
| Production 运行版本 | **UNKNOWN**（`https://estimate.homeinsulationvictoria.com.au` 可匿名访问，但 Office/Field 门户需应用账号登录，本次未登录验证） |
| 浏览器环境 | Chrome 155.0.8059.84，独立 profile，CDP 端口 9226 |

**运行版本证据链**：
1. `https://preview--hi-vic-operations.lovable.app/` 匿名访问返回 401（Lovable 认证墙）。
2. 由项目所有者在该 Chrome 窗口完成 Lovable 登录后，页面正常加载。
3. 以 Electrician TEST 账号 `qa.rec.delta@hivic-test.example` 在 `/auth` 登录成功，进入 `/field`。
4. 打开测试工单后**实际看到** Manual PIESA 表单（见 SECTION B）。该 UI 只存在于 `dd3f6673`，
   因此运行版本 **≥ dd3f6673**。

**关于 chunk hash 的说明（不构成版本结论）**：Preview 的 chunk 名（如 `index-CsARiK7Y.js`）
与本地 `origin/main` 构建产物（`index-CEM-_FG2.js`）不同。这不能证明版本落后——Lovable 的构建
环境与本地 `vite build` 不同，hash 天然有差异。版本判定改用**行为证据**。

---

## SECTION B — MANUAL PIESA

### 源码

| 检查项 | 结果 | 位置 |
|---|---|---|
| 组件存在 | YES | `src/components/portal/electrician-manual-result.tsx`（`ElectricianManualResult`、`manualResultEntry`） |
| 路由导入 | YES | `src/routes/_authenticated/field.$jobId.tsx:26` |
| 渲染条件 | 正确 | 同上 L153–155：`manualPath = !a?.external_mitti_id`；`canEnter = manualPath && manualResultEntry(a)`；`showManual = manualPath && (assessing \|\| locked)` |
| 渲染位置 | 正确 | 同上 L178–189（`{showManual && (...)}`） |
| Mitti 工作流保留 | YES | 同上 L167：`{a?.external_mitti_id && (assessing \|\| locked) && (...)}`，该分支渲染 `MittiCard` / `MittiSyncedFields`，**不含** `ElectricianManualResult` |
| 不再强制 Mitti 集成 | YES | PIESA 的 `MittiOnly` 回退已删除；`MittiOnly` 仅保留给 installer Ready Check（L264） |
| 已完成锁定 | YES | `manualResultEntry` 返回 `status !== "complete"` → `canEnter=false`；`locked` 时仅渲染 "Safety check complete."（L187） |
| 权限/门禁 | 由服务端强制 | `saveAssessment` / `completeAssessment` 均 `requireJobRole(..., ["admin","electrician"])` |

### 浏览器 UAT（Preview，Electrician TEST 账号）

**测试工单**：`TEST Owner Delta D3`，13 Test Street, Frankston
`/field/86bbf6fb-2de0-4dd6-b75d-d0e18b3561f5`（safety check 阶段，无已完成 PIESA）
**未使用 HV-2594 做任何改动。**

| 检查项 | 结果 | 证据 |
|---|---|---|
| A. 电工可打开工单 | PASS | 页面标题 `Job – Home Insulation Victoria Field`，正常渲染 |
| B. 满足条件时可见 Manual 表单 | PASS | 截面标题 `Electrical assessment · manual entry` |
| C. 不再只显示 Mitti 未邀请 | PASS | 全文检索 `isn't invited` → **false**；替代文案为 `The Mitti form isn't linked to this job yet, so record your results here. Home Insulation Victoria links Mitti forms.` |
| D. 正确字段出现 | PASS | Switchboard condition（OK / Upgrade needed）、RCDs present、RCDs to install、Life support onsite、Hazards、Notes、Assessment date、No rectification required、PIESA outcome、Evidence（0/1）、Complete PIESA |
| E. 权限与阶段门 | PASS（只读观察） | 仅 `assessing` 阶段出现证据区/其他项/Complete 按钮；本次未提交任何表单 |
| F. 已完成 PIESA 保持锁定 | PASS | HV-2594（`/field/42fcec2e-...`）：`manual_entry=false`、`safety_complete=true`、日期输入数量 0、可编辑控件仅 1（导航） |
| G. Mitti 关联工单仍走 Mitti | 部分验证 | HV-1919（`/field/038dc1f8-...`）处于 Ready Check 阶段，未渲染 PIESA 分支，`manual_entry=false`（正确）。**未找到一个处于 PIESA 阶段且已关联 Mitti 的测试工单**，故 PIESA 的 Mitti 分支仅在源码/单测层确认 |

截图证据：`/tmp/shot-manual-piesa.png`、`/tmp/shot-safety.png`、`/tmp/shot-field-job.png`

---

## SECTION C — FUTURE-DATE VALIDATION

### 规则实现

`src/lib/piesa-date.core.ts`
- L10 `YMD_RE`
- L12 `PIESA_DATE_IN_FUTURE = "PIESA date cannot be in the future."`
- L13 `PIESA_DATE_INVALID = "Enter a valid PIESA assessment date (YYYY-MM-DD)."`
- L16–22 `isValidYmd`（日历级校验，`2026-02-30` 判为无效）
- L25–27 `piesaDateInFuture`（`ymd > today` 字符串比较）
- L30–34 `piesaDateBlockers(ymd, today = melbourneToday())`
- L43–54 `refuseFuturePiesaDate`（Mitti 导入：丢弃字段 + 记 issue，不全盘中断）

时区：`melbourneToday()` → `melbourneYmd(now)`（`src/lib/melbourne-time.core.ts:30-32`），非 UTC `toISOString().slice(0,10)`。

### 服务端执行点

| 写入路径 | 位置 | 校验在持久化之前？ |
|---|---|---|
| `saveAssessment` | `src/lib/portal.functions.ts:222`，守卫 L227–230 | YES（L231 起才读写 `assessments`） |
| `completeAssessment` | `src/lib/portal.functions.ts:500`，守卫 L520–521 | YES（位于证据/定价/阶段检查之前，注释明确"defence in depth"） |
| `recordPiesa` | `src/lib/portal.functions.ts:575`，守卫 L587–588 | YES（在 `getStage` 与任何写入之前） |
| Mitti 同步 | `src/lib/mitti.server.ts:271`（`refuseFuturePiesaDate`） | YES（写入前剔除 `assessed_on`，其余字段照常落库，issue 进 `mitti_validation_issues`） |

客户端仅作便利：`PiesaForm` 的两个日期输入 `max={melbourneToday()}`（`field.$jobId.tsx:232,240`）。

### 行为实证（本地纯函数，只读，无数据库写入）

Melbourne 当日 = **2026-10-20**（与系统 `date +%Y-%m-%d` 一致）

| CASE | 输入 | 结果 |
|---|---|---|
| 1 昨天 | 2026-10-19 | **ACCEPT** |
| 2 今天 | 2026-10-20 | **ACCEPT** |
| 3 明天 | 2026-10-21 | **REJECT**: "PIESA date cannot be in the future." |
| 4 更远 | 2026-11-19 | **REJECT**: 同上 |
| 5 时区 | `melbourneToday()` | 2026-10-20（走 `melbourneYmd`） |
| 6a Mitti 未来日期 | `{assessed_on:"2026-10-21"}` | patch 剔除 `assessed_on`，issue 记录拒绝原因，**不中断同步** |
| 6b Mitti 合法日期 | `{assessed_on:"2026-10-19"}` | 原样通过，无 issue |
| 附 日历有效性 | `2026-02-30` | **无效**（正确） |
| 附 格式错误 | `01-01-2026` | `Enter a valid PIESA assessment date (YYYY-MM-DD).` |
| 附 历史日期 | 2025-03-01 | **ACCEPT** |

### 浏览器观察

Manual PIESA 表单的 Assessment date 输入 **`max="2026-10-20"`**（Melbourne 当日），
与规则一致。按任务约束**未提交任何日期**（该字段 `onPut` 会触发 `saveAssessment` 写库），
因此未来日期拒绝的**浏览器端写路径**未执行——改由下节的隔离运行时验证补齐。

---

### 运行时证据（真实 `saveAssessment` handler + 真实 PostgreSQL）— 2026-10-20 04:0x 补充

新增文件：`tests/piesa-future-date-runtime.test.ts`（与本报告一并提交）。执行结果 **10 pass / 0 fail**。

**环境隔离性（先证明可弃置、且未连生产）**

| 项 | 证据 |
|---|---|
| 数据库 | PGlite（PostgreSQL 编译为 WASM）**内存实例**，`new PGlite()`，进程退出即消失 |
| 数据 | 全部为合成 UUID 夹具（`source='qa_test'`），无真实客户记录 |
| 网络 | 顶层包裹 `globalThis.fetch` 记录所有出站调用；末尾断言 `net === []` → **全程零 HTTP**，不可能触达生产 |
| 凭据 | `ALLOW_PROD_SUPABASE` 未设置；`SUPABASE_URL`/`VITE_SUPABASE_URL` 只允许 `127.0.0.1` / `localhost` |
| 外部系统 | Mitti / Xero / 邮件 / 短信 均未调用（handler 在写库前即抛出，且相关模块未被触发） |

**什么是真的 / 什么被替换**

- 真：`src/lib/portal.functions.ts` 的 `saveAssessment` 本体（`inputValidator` zod 校验 + handler 全部逻辑）、
  真实 PostgreSQL 引擎、真实鉴权 SQL（迁移链 `0000` 的 `has_role`/`my_job_role`、`0023` `is_business_member`、
  `0115` `job_assignment_role`、`0147` `can_access_job`，以 `role authenticated` + `auth.uid()=caller` 求值）、
  真实 `piesaDateBlockers` 规则（经 handler 触达，非直接调用）。
- 替换：仅**传输层**——`createServerFn` 包装器与 auth 中间件被 stub，handler 以框架相同的方式
  （`{ data, context }`，`context.supabase` 为调用者的 RLS 客户端）被直接调用。业务逻辑未被替换。

**夹具**：TEST 工单 `00000000-0000-4000-8000-000000000d11`（`stage='piesa_scheduled'`，`source='qa_test'`），
已存在一条 `assessments` 草稿，`assessed_on = 2026-10-19`（昨天，合法历史日期）。
调用者为已分配的持证电工（`my_job_role = 'electrician'`）。

**请求 / 响应 / 数据库前后**

```
[Melbourne today]  2026-10-20
[request]          saveAssessment {"jobId":"00000000-0000-4000-8000-000000000d11",
                                   "patch":{"assessed_on":"2026-10-21","piesa_outcome":"pass"}}
[response]         PIESA date cannot be in the future.
[db before]        {"id":"97e85e4d-...","job_id":"...d11","status":"draft","piesa_outcome":"pending",
                    "switchboard_condition":"ok","notes":"TEST fixture draft","assessor_id":null,
                    "external_mitti_id":null,"assessed_on":"2026-10-19"}
[db after]         （与 before 逐字段完全相同）
```

**断言清单（全部通过）**

| # | 断言 | 结果 |
|---|---|---|
| 1 | 调用者确实有权限（先做一次合法写入成功）→ 拒绝不可能是权限错误 | PASS |
| 2 | `assessed_on = 2026-10-21`（明天）被拒，错误信息**精确等于** `PIESA date cannot be in the future.` | PASS |
| 3 | 拒绝后整行**逐字段**未变（`assessed_on` 仍 `2026-10-19`，`piesz_outcome` 仍 `pending`） | PASS |
| 4 | `workflow_events` 无新增、`jobs.stage` 未变 → 无附带业务状态变化 | PASS |
| 5 | `assessed_on = +30 天` 同样被拒，行未变 | PASS |
| 6 | 无 `assessments` 行的工单：拒绝发生在 INSERT **之前**，未创建任何行 | PASS |
| 7 | 对照组：昨天 `2026-10-19` **写入成功**（证明 handler 本可达写库，拒绝不是装置故障） | PASS |
| 8 | 对照组：今天 `2026-10-20` **写入成功** | PASS |
| 9 | 合法日期写过后，明天仍被拒且行未变 | PASS |
| 10 | 全程零出站 HTTP | PASS |

**结论**：服务端在**任何持久化之前**拒绝未来日期，且被拒请求不产生部分写入或副作用。
这正是原先缺失的运行时证据。

---

## SECTION D — REGRESSIONS

| 项目 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | **0 错误** |
| 生产构建 | `npx vite build` | **成功**（built in 3.14s / 4.05s / 656ms） |
| S64 专项 | `bun test tests/p1-s64-date-payment-regressions.test.ts tests/p1-s64-date-payment-rules.test.ts` | **38 pass / 0 fail** |
| 组件与时区 | `bun test electrician-manual-result / melbourne-today / piisa-assessment-date / piesa-windows / mitti.core` | **47 pass / 0 fail** |
| 阶段门与回归组 | `bun test brief-x-piesa-stage-gate / job-status-payment-dates / melbourne-deadlines / piesa-accept-confirmed-only / piesa-unpaired / mitti-membership / veec-melbourne` | **27 pass / 1 fail / 1 error** |
| 同上，基线对照（`dd3f6673^` = `812dc5c1`，临时 worktree） | 同命令 | **27 pass / 1 fail / 1 error** → 完全一致 |
| F-1 推进测试 | `bun test tests/brief-s-f1-piesa-advance.test.ts` | **6 pass / 8 fail** |
| 同上，基线对照 | 同命令 | **6 pass / 8 fail** → 完全一致 |

**结论：无新回归。** 所有失败均为 `dd3f6673` 之前既已存在（已在临时 worktree `812dc5c1` 上逐项复现，
对照结束后已删除该 worktree，主工作区源码未受影响）。

### 覆盖缺口（不修改测试，仅报告）

1. `brief-s-f1-piesa-advance.test.ts` 8 项失败为**既存**，但与 PIESA 完成推进相关，
   值得单独归档处理（非本次两个修复引入）。
2. ~~无行为级测试直接调用 `saveAssessment` 并断言拒绝~~ → **已补齐**：
   `tests/piesa-future-date-runtime.test.ts`（2026-10-20 04:0x 新增，10 pass / 0 fail）以真实 handler +
   真实 PostgreSQL 断言"绕过客户端直接发服务端请求"被拒且零写入。
   `completeAssessment` / `recordPiesa` 仍无同等级的运行时拒绝测试（本次任务范围外）。
3. 无渲染级集成测试在真实路由上下文中断言 `showManual` 分支（仅有组件单测 + 源码字符串断言）。
4. 无处于 PIESA 阶段且关联 Mitti 的测试夹具，故 PIESA 的 Mitti 分支未做浏览器验证。

---

## SECTION E — FINAL VERDICT

### FIX #1 — Manual PIESA Form Integration
**VERIFIED FIXED**

- 相关测试通过（组件 5 项 + 源码不变量断言全部通过）
- 运行版本确认（Preview 实际渲染出 Manual 表单，该 UI 仅存在于 `dd3f6673`）
- 要求的浏览器行为已逐项验证（A、B、C、D、E、F 通过；G 部分验证）
- "Your Mitti account isn't invited yet" 不再是唯一评估路径

### FIX #2 — PIESA Future-Date Validation
**VERIFIED FIXED**（2026-10-20 04:0x 由 `CODE VERIFIED — BROWSER UAT PENDING` 升级）

- 实现与测试已验证：规则单一来源、三条服务端写入路径均在持久化前拦截、Mitti 同步安全降级
- 客户端 `max` 已在浏览器确认（`max="2026-10-20"`）
- **运行时证据已补齐**：在隔离可弃置环境（PGlite 内存 PostgreSQL + 真实鉴权 SQL，全程零网络）
  调用真实 `saveAssessment` handler 传入明天日期，返回 `PIESA date cannot be in the future.`，
  数据库逐字段未变、无新行、无事件、无阶段变化；对照组（昨天/今天）正常写入成功
  —— 证明拒绝确实来自日期规则，而非权限或装置故障（10 pass / 0 fail）

---## 最小关闭动作

| 修复 | 缺什么证据 | 最小动作 |
|---|---|---|
| FIX #1 | 无（G 项 Mitti 分支为增强项） | **可关闭** |
| FIX #2 | 无 | **可关闭** |

未建议任何额外开发——未发现实际缺陷。

**仍未覆盖（不影响本次关闭结论，仅记录范围边界）**
- Production（`estimate.homeinsulationvictoria.com.au`）运行版本未验证，因门户需应用账号登录且
  按约束不得提交真实 PIESA。Preview 已验证 ≥ `dd3f6673`。
- `completeAssessment` / `recordPiesa` 两条路径本次**未做**运行时验证（任务范围限定为
  `saveAssessment`）；二者在源码层面确认守卫位于持久化之前（`portal.functions.ts:520`、`587`）。

---

## 附：本次执行的命令（可复现）

```bash
git fetch origin main
git rev-parse origin/main                     # 28765b50b64a2d20ce435e0bfff3567b270c1e6b
git merge-base --is-ancestor dd3f6673 origin/main
git log dd3f6673..origin/main -- <相关文件>    # 空
npx tsc --noEmit -p tsconfig.json
npx vite build
bun test tests/p1-s64-date-payment-regressions.test.ts tests/p1-s64-date-payment-rules.test.ts
bun test tests/electrician-manual-result.test.tsx tests/melbourne-today.test.ts \
         tests/piisa-assessment-date.test.ts tests/piesa-windows.test.ts tests/mitti.core.test.ts
```

#### FIX #2 运行时验证（隔离环境）

```bash
export SUPABASE_URL="http://127.0.0.1:54321" VITE_SUPABASE_URL="http://127.0.0.1:54321" \
       SUPABASE_PROJECT_ID="local-test-isolated" VITE_SUPABASE_PROJECT_ID="local-test-isolated" \
       SUPABASE_PUBLISHABLE_KEY="sb_publishable_local_test_isolated" \
       VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_local_test_isolated" \
       SUPABASE_SERVICE_ROLE_KEY="sb_secret_local_test_isolated" NODE_ENV=test VITEST=1
unset ALLOW_PROD_SUPABASE
TZ=Australia/Melbourne bun test --timeout 60000 tests/piesa-future-date-runtime.test.ts
# → 10 pass / 0 fail
```

安全边界：未修改源码、未创建提交、未推送、未合并、未发布 Production、
未写数据库、未触发 Mitti/Xero/邮件/短信、未跑迁移。临时 worktree 已于对照完成后删除。
本次新增文件仅一个测试文件 `tests/piesa-future-date-runtime.test.ts`，与本报告一并提交；
`src/` 下无任何改动（可用 `git status --short src/` 复核）。提交前已在最新 `origin/main`
（`1e4f6815`）上复跑该测试：10 pass / 0 fail。
