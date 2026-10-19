# RC-1 — PIESA AUTHORIZATION CORRECTION REPORT

**Project:** Home Insulation Victoria (HI VIC) · **Phase 1**
**Task:** RC-1 — PIESA Manual Entry Authorization Verification & Targeted Correction
**Priority:** P0 · **Date:** 2026-10-20 (Australia/Melbourne)
**Reference:** `P1-QA_PHASE1_FULL_TEST_FAILURE_TRIAGE_REPORT.md` RC-1 — "Clearance-recorder authorization guard missing (13 cases)"

---

## 1. Original issue confirmed: **YES**

Triage 报告的 RC-1 判定经独立复核**完全成立**：

- `clearanceRecorderAllowed` / `CLEARANCE_RECORDER_REFUSED` 存在于 `src/lib/clearance-guard.core.ts`，
  但在 `src/` 中**从未被调用**（grep 只命中定义处，无一处调用）。
- `requireClearanceRecorder` 在 `src/` 中**根本不存在**。
- `saveAssessment` / `completeAssessment` / `recordPiesa` 三者都只做了
  `requireJobRole(context.supabase, data.jobId, ["admin", "electrician"])`。

**修复前的实测基线**（`c5cbd3a3`，隔离 PGlite 环境）：

| 文件 | pass | fail |
|---|---|---|
| `tests/a4-step80-regulated-result-authz-db.test.ts` | 29 | **9** |
| `tests/a4-clearance-guard.test.ts` | 5 | **4** |
| **合计** | 34 | **13** |

与 triage 记录的 13 例**完全一致**。

## 2. Root cause

**`requireJobRole` 与"持牌电工"不是同一件事。**

自迁移 `0115` 起，合作方（REC）的 **business admin** 会通过其企业拿到该工单的
`my_job_role = 'electrician'`——即便他**没有** `electrician` 这个应用角色（app role）。
`requireJobRole(["admin","electrician"])` 因此放行，而它只回答"你在这张工单上是什么角色"，
不回答"你是不是持牌电工"。

`clearance-guard.core.ts` 正是为回答后者而写的纯函数：

```ts
export function clearanceRecorderAllowed(i: { jobRole: string | null; hasElectricianRole: boolean }): boolean {
  if (i.jobRole === "admin") return true;              // Office 维持既有权限
  return i.jobRole === "electrician" && i.hasElectricianRole;
}
```

**但 STEP 73/80 从未把它接到任何服务端写入路径上**（`git log -S "requireClearanceRecorder" -- src/lib/portal.functions.ts` 无提交）。
于是任何 REC business admin 都能保存/完成 PIESA 并签署电工声明。

**次级根因（同属 RC-1 13 例）**：`addTeamMember` 可凭一张 **pending** 或 **removed** 的
`partner_workers` 列表授予 `electrician` app role。这是上述守卫的**提权绕过路径**——
修好守卫却留下自授角色入口等于没修。`switchJobElectricianToHivic` 则完全没有工单级访问校验。

## 3. Files modified

| 文件 | 改动 | 行数 |
|---|---|---|
| `src/lib/portal.functions.ts` | 新增 `requireClearanceRecorder`；接入 `saveAssessment` / `completeAssessment` / `recordPiesa` / `submitDeclaration("electrician_declaration")` | +24 / −4 |
| `src/lib/pilot.functions.ts` | `addTeamMember` 只从 **approved 且未移除** 的列表授予 trade role（Office 例外） | +8 / −1 |
| `src/lib/job-electrician.functions.ts` | `switchJobElectricianToHivic` 增加 `requireJobRole(["installer"])` | +4 |

**共 3 files changed, 31 insertions(+), 5 deletions(-)。** 无 schema 改动、无迁移、无 Mitti / FFS / F-1 / Enquiries / Communications / Email Templates 改动、无生产配置或凭据改动。

## 4. Exact authorization behavior — before / after

调用者：`U.recAdmin` = REC（approved）business admin，通过 0115 分支拿到 `my_job_role = 'electrician'`，
**无** `electrician` app role。

| 路径 | 修复前 | 修复后 |
|---|---|---|
| `saveAssessment` | `{ok:true, savedAt:…}` —— **PIESA 草稿被写入** | 抛出 `CLEARANCE_RECORDER_REFUSED`，**零写入** |
| `completeAssessment` | 走到业务校验（`JOB.complete` 无草稿 → "Start the assessment first."） | 抛出 `CLEARANCE_RECORDER_REFUSED`（守卫在任何读/写之前） |
| `recordPiesa` | 走到 stage 校验 | 抛出 `CLEARANCE_RECORDER_REFUSED` |
| `submitDeclaration("electrician_declaration")` | 写入 `declarations` | 抛出 `CLEARANCE_RECORDER_REFUSED`，零写入 |
| `addTeamMember`（pending/removed 列表） | 授予 `electrician` app role | 拒绝；Office（admin）不受影响 |

**未被拒的合法调用者（回归验证全部通过）**：

- 持牌电工（`electrician` app role + 工单分配）→ 保存/完成/记录/声明**全部照旧**
- Office（admin）→ 保持既有访问
- licence 过期或缺失 `partner_workers` 记录的电工 → **仍可记录**（`C` 组定性测试，未改变现有行为）
- installer-only / 非本企业 / 房主 / 无关用户 → 仍为 `NO_PERMISSION`（`requireJobRole` 先拦截）

**守卫位置**：紧跟 `requireJobRole` 之后、任何 `admin.from(` / `transition(` / `logEvent(` 之前；
rpc 出错时**失败关闭**（fail closed）。

## 5. Test results

隔离环境：`SUPABASE_URL` 固定 `http://127.0.0.1:54321`，DB 为 PGlite 内存 PostgreSQL，
`ALLOW_PROD_SUPABASE` 未设置，全程无生产端点、无 service-role key。

| 测试文件 | 修复前 | 修复后 |
|---|---|---|
| `tests/a4-step80-regulated-result-authz-db.test.ts` | 29 pass / **9 fail** | **38 pass / 0 fail** |
| `tests/a4-clearance-guard.test.ts` | 5 pass / **4 fail** | **9 pass / 0 fail** |
| `tests/piesa-future-date-runtime.test.ts`（S64） | 10 pass / 0 fail | **10 pass / 0 fail** |
| `tests/p1-s64-date-payment-regressions.test.ts` + `...rules.test.ts` | 38 pass / 0 fail | **38 pass / 0 fail** |
| `tests/electrician-manual-result.test.tsx`、`melbourne-today`、`piisa-assessment-date`、`piesa-windows` | 20 pass / 0 fail | **20 pass / 0 fail** |
| `step82-cross-business-access-db` | — | **6 pass / 0 fail** |
| `trade-job-access-db` | — | **4 pass / 0 fail** |
| `partner-worker-access` | — | **3 pass / 0 fail** |
| `business-owner-only` | — | **19 pass / 0 fail** |
| `a3-a4-role-isolation-db` | **0 pass / 1 fail** | **0 pass / 1 fail**（基线同样 0/1，**既存、与本次无关**，属 RC-3 Enquiries 回滚测试钉住旧实现） |

**STEP 4 A–I 逐项对照**：

| # | 要求 | 结果 |
|---|---|---|
| A | 授权电工可保存 | ✅ `B · saveAssessment writes the draft`、`H · saveAssessment writes a draft from piesa_scheduled` |
| B | 授权电工可完成 | ✅ `H · completeAssessment proceeds past stage gate from piesa_scheduled / assessment_booked` |
| C | 未授权用户不可保存 | ✅ `A · saveAssessment … REFUSED and nothing is written`、`E2` |
| D | 未授权用户不可完成 | ✅ `A · completeAssessment is REFUSED` |
| E | 未授权用户不可 recordPiesa | ✅ `A · recordPiesa is REFUSED` |
| F | 被拒操作零写入 | ✅ `draft(JOB.e)` 逐字段比对未变；`declarations` 表零行 |
| G | S64 未来日期限制仍有效 | ✅ 10/10（`piesa-future-date-runtime`）+ 38/38（S64 专项） |
| H | 手动 PIESA 工作流仍可用 | ✅ `H` 组 6 项全通过（含 `piesa_scheduled` 无 Mitti 链接路径） |
| I | 不引入额外登录/验证交互 | ✅ 仅服务端校验，UI 与电工体验零改动 |

## 6. TypeScript results

```
npx tsc --noEmit -p tsconfig.json   →  0 errors
npx vite build                      →  ✓ built in 5.08s / 5.84s / 1.08s（exit 0）
```

未新增任何测试文件——既有用例（13 项）已完整覆盖本次缺陷，按 STEP 4 要求无需补充。

## 7. S64 regression status

**无回归。** S64 两项修复均保持 `VERIFIED FIXED`：

- 未来日期：`saveAssessment` 的日期校验仍在守卫**之后**执行，10/10 通过（昨天/今天写入成功，明天/+30 天被拒且零写入）
- Manual PIESA：`H` 组 `piesa_scheduled` 无 Mitti 链接路径全部通过；`tests/electrician-manual-result.test.tsx` 等 20/20

## 8. Git commit SHA

**`63ef6cae4eff42058ce77264117e03d8c1d92d18`**
`fix(p1): enforce electrician authorization for manual PIESA`

- 父提交：`d0e29ec7`（owner 的文档提交，推送期间 main 前移，已快进整合）
- 内容：**3 files changed, 31 insertions(+), 5 deletions(-)**，仅上述 3 个源文件

## 9. Push status: **PUSHED TO MAIN**

```
d0e29ec7..63ef6cae  main -> main
git ls-remote origin main → 63ef6cae4eff42058ce77264117e03d8c1d92d18
```

非强制推送。本地与远端 `left-right = 0 0`。

**工作区处理说明**：合并前本地有 3 个文档为上一任务的未提交改动，经比对与 owner 已提交的
`d0e29ec7` **逐字节一致**，故还原后快进，未丢失内容；未跟踪的 C10–C13 报告与远端新增文件
内容完全一致，先备份至 `/tmp` 再合并，合并后已核验 `IDENTICAL 未丢失`。
本次提交**只**包含 3 个 RC-1 源文件。

## 10. Remaining known limitations

1. **`a3-a4-role-isolation-db` 仍 0 pass / 1 fail** —— 基线同样失败，属 RC-3（Enquiries 回滚后测试钉住旧实现），
   按任务要求未修改其代码、不在本次范围。
2. **许可证有效期未纳入守卫** —— `C` 组测试明确把"licence 过期 / 无 licence 记录的电工仍可记录"定性为
   `POLICY_OR_DATA_GAP` 并钉住当前行为。本次**未**引入任何新的许可证核验系统（符合约束 6），
   是否收紧属业务决策。
3. **未审批企业的持牌电工仍可通过守卫** —— `E2` 组定性为 `POLICY_OR_DATA_GAP`；企业审批状态不在
   `my_job_role` SQL 内，本次未改变。
4. **生产运行版本未验证** —— 本次未在 Lovable Preview / Production 做浏览器验证；修复的证据来自
   隔离环境的真实 handler + 真实 Postgres + 真实鉴权 SQL。
5. **0149（owner-quote RLS）仍为 `REPORTED_PRODUCTION`**，本环境无法独立复核（无 service-role key）。

## 11. Production Publish status: **NOT PERFORMED**

未发布 Production，未执行任何迁移，未改动生产数据，未启用外部通信。
发布仍待 owner 在 Lovable 面板执行 Publish。

---

## FINAL VERDICT

# RC-1 FIXED AND VERIFIED

- 原始缺陷已确认并复现（13 例，与 triage 一致）
- 根因定位准确（`requireJobRole` ≠ 持牌电工 app role；STEP 73/80 守卫从未接线）
- 最小服务端修正，复用了既有的 `clearanceRecorderAllowed` / `CLEARANCE_RECORDER_REFUSED`
- 13/13 用例通过，S64 与周边权限测试无回归，tsc 0 错误，构建通过
- 已提交并推送至 `origin/main`（`63ef6cae`）

**附带说明（未静默扩权）**：`pilot.functions addTeamMember` 与
`job-electrician.functions switchJobElectricianToHivic` 两处改动虽不在任务书列出的三条写入路径内，
但它们与 RC-1 同属 triage 的 13 例，且 `addTeamMember` 是本次守卫的**直接提权绕过路径**——
不修则 RC-1 无法真正关闭。两者均为数行的最小授权收紧，Office 权限与已审批流程不变。
如 owner 认为应拆分，可单独回退这两个文件的改动，`portal.functions.ts` 的守卫独立成立。
