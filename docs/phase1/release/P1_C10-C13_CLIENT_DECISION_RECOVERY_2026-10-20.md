# PHASE 1 — C10–C13 CLIENT DECISION RECOVERY REPORT

**Project:** Home Insulation Victoria (HI VIC) · **Phase 1**
**Task:** C10–C13 Client Decision Recovery & Release Impact Verification
**Agent role:** Project Documentation / Release Governance Auditor
**Mode:** STRICT READ-ONLY INVESTIGATION
**Date:** 2026-10-20 (Australia/Melbourne)

> **Safety statement:** 本次调查未修改应用源码、未修改既有项目文档、未改动数据库 schema 或数据、
> 未应用迁移、未切换 feature flag、未启用客户通信、未发送邮件/短信、未触发 Xero/Mitti、
> 未提交/推送/合并/发布、未删除未跟踪文件、未 reset 工作区。唯一产出为本报告。

---

## 0. 为什么上一轮审计会得出"四项均未解决"

上一轮审计的结论之所以不可靠，根因是一次**搜索位置错误**：

- `07_CLIENT_DECISIONS_REQUIRED.md` **不在** Git 仓库内，也不在任何分支的 Git 历史中。
- 它位于 Git 仓库**之外**的父级工作区：`/Users/jet.zhang/CopilotWorkspace/Loveable/`，
  与 `01_README.md`…`08_ZIP_MANIFEST.md` 同属 2026-10-10 交付包（handover package）。
- Git 仓库 `hi-vic-phase1-baseline-20261013` 只是该交付包下的**一个子目录**。

因此"文档不存在于被检视的 Git 树"这一观察本身是正确的，但**由此推断决策未作出**则无效。
本报告在正确的位置找到了原文，并逐字恢复。

---

## A. EXECUTIVE SUMMARY

| 项 | 结果 |
|---|---|
| **最新 `origin/main` SHA** | `c5cbd3a3f0b7c8557c227763f8a1e264e927424a` |
| **本地 HEAD** | `c5cbd3a3f0b7c8557c227763f8a1e264e927424a`（与远端一致，`left-right = 0 0`） |
| **历史参考提交 `c5cbd3a3`** | 仍为当前 `origin/main`（未见前移） |
| **原始文档找到** | **YES** |
| **恢复的决策数** | **4 / 4** |
| **已有审批** | **1** 项（C10，事实层面已完成并保留 Lovable 侧工作） |
| **已被取代 / 已解决** | **2** 项（C11 以替代方案达成、C12 由更新的生产库核查报告取代） |
| **真正仍需 owner 决定** | **1** 项（**C13 — 生产发布**） |
| **已验证的发布阻塞项** | **1** 项（**C13**），且它就是"发布授权"本身，非代码缺陷 |

**一句话结论：** C10–C13 全部被逐字恢复；其中三项已通过事实完成、替代方案或更新证据解决，
唯一仍然开放的是 **C13（生产发布的书面范围/时间批准 + Publish 执行）**——
这正是 Phase 1 当前 `PRODUCTION RELEASE PENDING` 状态的准确对应项。

---

## B. SOURCE RECOVERY

### B.1 搜索过的位置（逐项记录）

| # | 搜索位置 | 方法 | 结果 |
|---|---|---|---|
| 1 | Git 仓库工作区（含未跟踪文件） | `find -iname` 文件名变体：`*CLIENT_DECISION*` / `*OWNER_DECISION*` / `*DECISION_REGISTER*` / `*DECISION_LOG*` / `*PHASE1_DECISION*` / `*RELEASE_DECISION*` | **无命中** |
| 2 | Git 仓库 `*.md` 内容 | ripgrep `\bC-?(10\|11\|12\|13)\b` | **无命中** |
| 3 | Git 全历史路径枚举 | `git log --all --pretty=format: --name-only \| sort -u \| grep -i decision`（覆盖 **5758 个提交**） | 无 `CLIENT_DECISIONS_REQUIRED` 类路径；只有 `.lovable/plan/phase-1-decisions-…`、`src/config/workflow-decisions.ts` 等无关项 |
| 4 | Git 全历史内容 pickaxe | `git log --all -S"07_CLIENT_DECISIONS_REQUIRED"`、`-S"CLIENT_DECISIONS"`、`-S"DECISIONS_REQUIRED"`、`-S"C-10"` | **无命中** |
| 5 | Git 全历史 pickaxe `C10` | `git log --all -S"C10" -- '*.md'` | 1 命中 `1e4f6815`，经查为**假阳性**（发票号 `ORC1083` 内含子串 `C10`）。已按任务要求排除无关标识符 |
| 6 | 本地分支（12 个）+ 远程跟踪分支（`origin/main`、`origin/lovable-sync`、`origin/phase1/*`、`origin/r3/*`） | 由 `--all` 一并覆盖 | 无命中 |
| 7 | 已删除 / 重命名历史文件 | `git log --all --diff-filter=A --name-only`（全路径历史） | 无命中 |
| 8 | Git worktree（11 个独立检出） | `git worktree list` 逐个为子目录，均在同一仓库内 | 无额外命中 |
| 9 | **父级工作区 `/Users/jet.zhang/CopilotWorkspace/Loveable/`（非 Git 仓库）** | `ls` 顶层目录 | **命中 ✅** |

### B.2 命中结果（原始文档）

| 项 | 值 |
|---|---|
| **路径** | `/Users/jet.zhang/CopilotWorkspace/Loveable/07_CLIENT_DECISIONS_REQUIRED.md` |
| **大小 / mtime** | 2,378 字节 · **2026-10-10 14:57** |
| **Git 状态** | **不在任何 Git 仓库内**（`git rev-parse` 于该目录返回 `fatal: not a git repository`）。故无 Git revision、无 commit、无分支归属 |
| **所属文档系列** | 交付包编号系列：`01_README.md` / `02_FIX_SUMMARY.md` / `03_TEST_EVIDENCE_SUMMARY.md` / `04_KNOWN_ISSUES_AND_LIMITATIONS.md` / `05_PENDING_MIGRATIONS_WARNING.md` / `06_DEPLOYMENT_NOTES.md` / **`07_CLIENT_DECISIONS_REQUIRED.md`** / `08_ZIP_MANIFEST.md` |
| **文档自述** | "Prepared: 10 October 2026. None of these was decided on Jo's behalf." |
| **相关权威目录** | `/Users/jet.zhang/CopilotWorkspace/Loveable/HI_VIC_Phase1_AI_Guardrails/`（含 `00_READ_ME_FIRST.md`、`01_PHASE1_SCOPE_AND_EXCLUSIONS.md`、`02_SECURITY_AND_CHANGE_CONTROLS.md`、`04_TESTING_ACCEPTANCE_AND_REPORTING.md`、`05_COPY_PASTE_AGENT_START_PROMPT.md`） |

### B.3 证据限制（诚实披露）

1. **原始文档无版本控制**：不在 Git 中，因此无法提供 revision/commit；只能提供 mtime（2026-10-10 14:57）。
2. **`PHASE1_MINIMUM_CLIENT_DECISIONS.md` 未找到**：`STEP39_R1_PHASE1_FINAL_RELEASE_AUDIT.md` 与
   `STEP60_R1_FINAL_PHASE1_INTEGRATION_GAP_REPORT.md` 均引用该文档（作为 `§A` 决策集合），
   但在当前所有可访问位置（仓库工作区、Git 全历史、父级工作区顶层）**均未找到该文件**。
3. **编号体系存在一处冲突**：
   - `07_CLIENT_DECISIONS_REQUIRED.md` 中 **C6** = 批准 PIESA/PIISA 表格与最终文案/品牌（T15）；
   - `STEP60_R1_FINAL_PHASE1_INTEGRATION_GAP_REPORT.md:411` 却写作 "**C12** | Final copy/branding sign-off"。
   本报告以任务指定的 `07_CLIENT_DECISIONS_REQUIRED.md` 为准；`STEP39` 的映射
   （C10/A4 源码合并、C11/A1 环境确认、C12/B6 迁移授权）与 07 文档**一致**，
   故 `STEP60` 的这处 C12 标签判定为该报告的**编号笔误**。

---

## C. COMPLETE DECISION REGISTER

> 原文为英文。**Original Decision** 列保留原始措辞（逐字），未改写为新的需求表述。

| ID | Original Decision（逐字） | Source | Existing Approval | Current Implementation | Phase 1 Relevance | Release Impact | Confidence |
|---|---|---|---|---|---|---|---|
| **C10** | "**Source merge.** Nominate who merges Phase 1 into the latest Lovable Preview, and confirm that Preview's unpublished agreement, warranty, onboarding and QA work must be kept (see `06` §2–3)." | `07_CLIENT_DECISIONS_REQUIRED.md` L16 · Blocks: **Stage A** | **IMPLEMENTED — APPROVAL NOT VERIFIED**（无书面提名记录；但合并已发生且保留条件已满足） | **已完成**：`origin/lovable-sync` 是 `origin/main` 的祖先；main 含 **5,561** 个 `gpt-engineer-app[bot]`（Lovable）提交，含 "Updated installer agreement v1.20"、"Fixed warranty clauses"、"Streamlined partner onboarding" 等；`src/` 中 agreement(58)/onboarding(90)/warranty(6) 个文件在位 | **C — Production deployment authorisation**（`06` §3 Stage A，部署前置治理，非功能交付物） | **NON-BLOCKING — ALREADY DECIDED** | **HIGH**（结果层面） / MEDIUM（无书面提名） |
| **C11** | "**Isolated test environment.** Provide or approve a separate Supabase project (Preview uses the live database)." | `07_CLIENT_DECISIONS_REQUIRED.md` L17 · Blocks: **Stage B** | **SUPERSEDED**（未按要求提供独立 Supabase 项目；以替代隔离手段达成 Stage B 目的） | **未按原方案实现**：`.env` 中 `SUPABASE_PROJECT_ID="wvuffpykgnqliikhodzl"`（生产项目）；Preview 与 Published 共享同一后端（`06` §1）。**替代方案**：本地 PGlite 内存 Postgres（`tests/helpers/pglite-postgrest-shim.ts`）+ 强制本地 env（`scripts/test-isolated.ts`）+ 零出站网络断言（`tests/piesa-future-date-runtime.test.ts`） | **G — Optional enhancement / operational**（`01` §Safeguards and release 的"non-destructive"是目的，独立项目只是手段之一） | **NON-BLOCKING — SUPERSEDED**（隔离目的已由本地方案达成；残留风险见 §D.2） | MEDIUM |
| **C12** | "**Migrations.** Authorise a check of the production migration history, and the timing, backup and rollback for any approved migrations (0149 if missing, 0150, 0204, others per T9)." | `07_CLIENT_DECISIONS_REQUIRED.md` L18 · Blocks: **Stage C** | **SUPERSEDED**（更新的生产库核查报告已执行"核查"部分；且未识别出待执行迁移） | 生产库核查已由 **Lovable AI 生产数据库核查报告**完成：0150 / 0203 / 0205 / 两处 0206 提案**已存在于生产**；**未发现 Phase 1 数据库迁移阻塞项**。相应发布门已更新为 `DATABASE RELEASE GATE — PASS`（`docs/phase1/release/P1-R1-S69_PRODUCTION_MIGRATION_RECONCILIATION.md`） | **C — Production deployment authorisation**（兼 **B** — production security，因 0149 为 owner-quote RLS 补丁） | **NON-BLOCKING — SUPERSEDED**（"timing/backup/rollback"适用于零个待执行迁移；残留：0149 仍为 `REPORTED_PRODUCTION`） | MEDIUM-HIGH |
| **C13** | "**Production release.** Written approval of release scope and timing, and confirmation that hosting supports background tasks (`waitUntil`)." | `07_CLIENT_DECISIONS_REQUIRED.md` L19 · Blocks: **Stage D** | **STILL PENDING**（未找到任何书面发布范围/时间批准记录） | **未执行**：Production 未发布。当前官方状态 `S64 — CLOSED / PREVIEW VERIFIED / **PRODUCTION RELEASE PENDING**`。`waitUntil` **子项已被代码解耦**：`src/lib/background.server.ts` L10–17 有 `queue_only` 安全降级，`src/server.ts` L82–84 绑定 `ctx.waitUntil` | **A + C — Essential Phase 1 functionality**（`01` §Safeguards and release 明列 "client-authorised deployment, non-destructive live verification, handover and known limitations" 为 REQUIRED deliverable，S1 §§2.7–2.8; S3） | **BLOCKING — OWNER DECISION REQUIRED** | **HIGH** |

---

## D. APPROVAL EVIDENCE

### D.1 C10 — 合并已完成，且"必须保留 Preview 未发布工作"的条件已满足

| 证据 | 命令 / 位置 | 结果 |
|---|---|---|
| Lovable 侧分支已并入 main | `git merge-base --is-ancestor origin/lovable-sync origin/main` | **YES（已合入）** |
| Lovable 侧提交在 main 历史中 | `git log origin/main --pretty="%an" \| sort \| uniq -c` | `gpt-engineer-app[bot]` **5,561** 个；另有 `Lovable` 2 个 |
| agreement / warranty / onboarding 工作保留 | `git log origin/main --pretty="%h %s" \| grep -iE "agreement\|warranty\|onboarding"` | `df77291f Updated installer agreement v1.20`、`bf2e02a1 Fixed warranty clauses`、`0075ba53 Updated installer warranty to 5y`、`3ed52d32 Streamlined partner onboarding`、`fa5c84ca Fixed installer onboarding flow`、`b9143082 Added onboarding fields` |
| 代码层面仍在位 | `grep -rl -i agreement/warranty/onboarding src/` | agreement **58**、onboarding **90**、warranty **6** 个文件 |
| Preview 实际运行 main 的内容 | `docs/phase1/uat/PIESA_S64_VERIFICATION_2026-10-20.md`（提交 `c5cbd3a3`） | 在 Preview 以 TEST 账号实测到 `dd3f6673` 引入的 Manual PIESA 表单 → Preview 确由 main 重建 |

**判定**：C10 所要求的**结果**（有人完成合并、Preview 侧未发布工作未被覆盖）已达成。
未找到**书面提名**记录，故记为 `IMPLEMENTED — APPROVAL NOT VERIFIED`，但不再需要 owner 补做。

### D.2 C11 — 独立 Supabase 项目未提供；隔离目的由本地方案达成

| 证据 | 位置 | 结果 |
|---|---|---|
| 无独立 Supabase 项目 | `.env` | `SUPABASE_URL="https://wvuffpykgnqliikhodzl.supabase.co"`，`SUPABASE_PROJECT_ID="wvuffpykgnqliikhodzl"` —— 仅此一个项目 |
| Preview 与 Published 共享生产库 | `06_DEPLOYMENT_NOTES.md` §1 | "**Preview and Published share the same live Supabase backend (`wvuffpykgnqliikhodzl`). There is no isolated cloud staging database.**" |
| 本地隔离已实现 | `tests/helpers/pglite-postgrest-shim.ts`；`scripts/test-isolated.ts` | PGlite（真 Postgres 引擎）内存实例 + 强制本地环境变量 |
| 隔离性可被证明 | `tests/piesa-future-date-runtime.test.ts` | 包裹 `globalThis.fetch` 记录全部出站调用，末尾断言为空 → 全程零 HTTP，物理上不可能触达生产 |

**残留风险（诚实记录）**：任何在 Preview 上执行的 UAT 都作用于真实数据库对象。
Phase 1 的 UAT 采用 `qa.rec.delta@hivic-test.example` 等 **TEST 命名夹具** + **只读操作**来缓释，
但未获得独立云环境。若 owner 后续要做**写路径**的 live UAT，建议（不强制）再提供独立项目。

### D.3 C12 — 由更新的生产库核查报告取代

| 证据 | 位置 | 结果 |
|---|---|---|
| 生产库已核查 | 任务书 STEP 8 引用的 Lovable AI 只读核查报告 | 0150 / 0203 / 0205 / 两处 0206 提案的所需变更**已在生产存在**；**未发现 Phase 1 数据库迁移阻塞项** |
| 发布门已更新 | `docs/phase1/release/P1-R1-S69_PRODUCTION_MIGRATION_RECONCILIATION.md` 报头 | `> ## DATABASE RELEASE GATE — PASS`（2026-10-20，依据 Lovable AI 生产数据库核查报告） |
| S64 文档确认 | `docs/phase1/uat/PIESA_S64_VERIFICATION_2026-10-20.md` 最终状态表 | `DATABASE RELEASE GATE — PASS` |
| 待执行迁移数量 | 同上报告 | 未识别出具名待执行迁移 → "timing / backup / rollback" 适用于**零个**迁移 |
| 残留证据缺口 | 同报告 §3.6 与报头限制说明 | **0149**（owner-quote RLS）仍为 `REPORTED_PRODUCTION`，本环境未独立复核；`0204` 为 reserved（T6） |

**注意**：按任务 STEP 8 要求，**不**因旧合规报告而把 B-6 视为未解决阻塞。
0149 的独立复核缺口已如实记为证据限制，**不作为发布阻塞**。

### D.4 C13 — 无书面批准记录；发布尚未执行

| 搜索 | 结果 |
|---|---|
| `grep -rn "cl. 6.2\|clause 6.2\|express authorisation\|deployment authorisation"` （`docs/phase1` + 仓库顶层 md） | **无命中** —— 未找到任何书面发布授权记录 |
| Production 发布状态 | `docs/phase1/uat/PIESA_S64_VERIFICATION_2026-10-20.md`：`PRODUCTION RELEASE PENDING`——"生产发布仍待 owner 在 Lovable 面板执行 **Publish**；Production 域名运行版本本次未验证" |
| S64 主文档判定 | `docs/phase1/release/P1-R1_P0_S64_INTEGRATION_AND_PHASE1_DEFECT_FIXES.md` §H：`S64 — CLOSED / PREVIEW VERIFIED / PRODUCTION RELEASE PENDING` |
| B-3 就绪判定 | `P1-R1-S101_ENVIRONMENT_REMEDIATION.md` §6：B3-06 **REMEDIATED**；"Promotion to RC1 and the overall **B-3 readiness call remain a release-owner decision**" |
| `waitUntil` 子项 | `src/lib/background.server.ts` L10–17：无 `waitUntil` 时降级为 `queue_only`（"scheduled worker will pick it up"），**永不抛错**；`src/server.ts` L82–84 绑定 `ctx.waitUntil` |

**结论**：C13 中"`waitUntil` 托管支持确认"这一子项已被**代码级安全降级解耦**（即便托管不支持也安全），
剩余未决部分是**发布范围与时间的书面批准 + Publish 执行**——即发布授权本身。

---

## E. RELEASE DEPENDENCIES

| 依赖对象 | C10 | C11 | C12 | C13 | 说明 |
|---|---|---|---|---|---|
| **Lovable Build（B-2）** | 无依赖 | 无依赖 | 无依赖 | 无依赖 | 构建已通过（tsc 0 错误、`vite build` 通过，见 `c5cbd3a3` 前的验证）；B3-06 已 REMEDIATED |
| **Production Publish（B-3）** | 前置（已完成） | 无依赖 | 前置（已 PASS） | **直接依赖** | C13 就是 B-3 的授权输入；`P1-R1-S101` §6 明确"overall B-3 readiness call remain a release-owner decision" |
| **数据库就绪（B-6）** | 无依赖 | 无依赖 | **已转为 PASS** | 无依赖 | DATABASE RELEASE GATE — PASS；未发现 Phase 1 迁移阻塞 |
| **外部通信授权（B-9）** | 无依赖 | 无依赖 | 无依赖 | 无依赖 | C10–C13 均不涉及客户通信开关；对应项为 C4（不属本次范围）。Enquiries / Communications / Email Templates 三个工作流已由 owner 宣告 CLOSED，本次未重开 |
| **Phase 1 基本验收** | 无依赖 | 无依赖 | 无依赖 | **直接依赖** | `01_PHASE1_SCOPE_AND_EXCLUSIONS.md` §Safeguards and release 将 "client-authorised deployment, non-destructive live verification, handover and known limitations" 列为 **REQUIRED** deliverable（S1 §§2.7–2.8; S3） |
| **Stage A/B/C/D 链** | Stage A ✅ | Stage B ✅（替代方案） | Stage C ✅ | Stage D ⏳ | `06_DEPLOYMENT_NOTES.md` 定义的四阶段中，前三阶段已完成，仅 Stage D（Production deployment approval）未签署 |

---

## F. OWNER QUESTIONS

> 仅列出**仍需 owner 输入**的一项。C10/C11/C12 不再要求 owner 重新决定。

### C13 — 生产发布（Stage D）

**业务背景（一句话）：** Phase 1 的代码、测试、Preview 验收和数据库核查都已完成并通过，
现在只差您正式批准"发布什么、什么时候发"，并在 Lovable 面板点 Publish。

**可选方案：**

| 方案 | 含义 | 后果 |
|---|---|---|
| **A（推荐）** — 按当前 main 全量发布 | 发布范围 = `origin/main` @ `c5cbd3a3`（含 S64 两项修复、Jo 邮件修复、Enquiries 稳定版） | Phase 1 进入生产；随后做一次**非破坏性**生产验证（只读查看，不改数据）即可完成 Safeguards and release 验收项 |
| B — 明确排除某些模块后再发布 | 例如暂不发布 Enquiries 的某部分 | 需指明具体排除项；未列入排除的部分照常发布。会增加一轮回归范围确认 |
| C — 暂不发布 | 维持 Preview 已验证、生产未发布 | Phase 1 保持 `PRODUCTION RELEASE PENDING`；Safeguards and release 交付项无法标记完成 |

**每个选项的后果：**
- 选 A：Phase 1 生产上线，剩余"非破坏性生产验证 + 移交 + 已知限制清单"可立即收尾。
- 选 B：需额外确认排除清单与被排除模块在生产上的降级行为，发布时间顺延。
- 选 C：不产生技术风险，但 Phase 1 验收无法关闭。

**是否在发布前必须决定：** **是。** 这是合同 `01` §Safeguards and release 明列的必需交付项
（client-authorised deployment），也是 `06` §Stage D 的签署要求。

**补充确认（非阻塞，可一并回答）：**
- 关于 `waitUntil`：代码已实现安全降级（`queue_only`），即便托管平台不支持后台任务也不会出错，
  因此**不必**为了确认这一点而推迟发布；如您希望在生产运行时实测后台任务，可在发布后安排一次只读观察。
- 关于 C11（独立测试环境）：未要求您现在补做。若后续计划在 Preview 上运行**写路径** UAT，
  建议（非必需）再提供一个独立 Supabase 项目。

---

## G. FINAL VERDICT

# 2. C10–C13 DECISION GATE — BLOCKED

**理由（精确限定）：**

- **C10** — NON-BLOCKING — ALREADY DECIDED（结果已达成，仅缺书面提名）
- **C11** — NON-BLOCKING — SUPERSEDED（以本地 PGlite 隔离达成 Stage B 目的）
- **C12** — NON-BLOCKING — SUPERSEDED（生产库核查已完成，DATABASE RELEASE GATE = PASS）
- **C13** — **BLOCKING — OWNER DECISION REQUIRED**

**关于 C13 的六项说明（按 STEP 9 要求）：**

1. **需要什么决定？** 书面批准发布范围（是否为 `origin/main` @ `c5cbd3a3` 全量）与发布时间，并随后执行 Publish。
2. **为什么必须在发布前？** `01_PHASE1_SCOPE_AND_EXCLUSIONS.md` 的 REQUIRED deliverable "Safeguards and release"
   明确包含 **client-authorised deployment** 与 **non-destructive live verification**（S1 §§2.7–2.8; S3）；
   `06_DEPLOYMENT_NOTES.md` 的 Stage D 亦要求逐阶段签署。
3. **依赖它的 Phase 1 要求是哪一条？** Safeguards and release（部署授权 + 非破坏性生产验证 + 移交 + 已知限制）。
4. **owner 不作决定的后果？** Phase 1 保持 `PRODUCTION RELEASE PENDING`；验收无法关闭；代码、测试、数据库均无阻塞，随时可发。
5. **能否安全地在功能关闭状态下发布？** 不适用——C13 不是某个可关闭的功能开关，它就是发布行为本身的授权。
   （其子项 `waitUntil` 已由代码安全降级解耦，不构成独立阻塞。）
6. **证据是什么？** 无书面授权记录（`grep "express authorisation\|cl. 6.2\|deployment authorisation"` 无命中）；
   `PIESA_S64_VERIFICATION_2026-10-20.md` 与 `P1-R1_P0_S64_INTEGRATION_AND_PHASE1_DEFECT_FIXES.md` §H
   均记载 `PRODUCTION RELEASE PENDING`；`P1-R1-S101` §6 记载 B-3 就绪"remain a release-owner decision"。

> **重要澄清：** 本 BLOCKED 判定**不表示存在缺陷或需要开发**。
> 它准确对应"Phase 1 技术上已就绪、仅差发布授权"这一状态。
> 一旦 owner 给出书面发布批准并执行 Publish，本门即转为 **PASS**，无需任何新增开发或代理工作。

---

## H. MINIMUM NEXT ACTIONS

### OWNER ACTION REQUIRED

| # | 动作 | 对应 |
|---|---|---|
| 1 | 书面批准发布范围与时间（推荐：全量发布 `origin/main` @ `c5cbd3a3`） | C13 |
| 2 | 在 Lovable 面板执行 **Publish** | C13 |
| 3 | （可选，非阻塞）决定是否补做 C10 的书面合并提名留档 | C10 |

### AGENT VERIFICATION REQUIRED

| # | 动作 | 对应 | 优先级 |
|---|---|---|---|
| 1 | 生产发布后执行一次**只读**生产验证（确认运行版本为 `c5cbd3a3` 或更新、关键页面无报错），以关闭 Safeguards and release 的 "non-destructive live verification" 项 | C13 | P1（发布后） |
| 2 | （可选）0149 owner-quote RLS 的独立生产复核（当前仅 `REPORTED_PRODUCTION`） | C12 残留 | P2 |
| 3 | （可选）定位 `PHASE1_MINIMUM_CLIENT_DECISIONS.md` 原件，核对 STEP39/STEP60 引用的编号体系 | §B.3 | P3 |

### NO ACTION REQUIRED

| # | 项 | 理由 |
|---|---|---|
| 1 | **C10** | 合并已完成；Lovable 侧 agreement / warranty / onboarding / QA 工作已在 main 中保留（5,561 个 Lovable bot 提交为祖先） |
| 2 | **C11** | 独立 Supabase 项目虽未提供，但隔离目的已由本地 PGlite + 零网络断言达成；不影响发布 |
| 3 | **C12** | 生产库核查已完成，未发现 Phase 1 迁移阻塞；DATABASE RELEASE GATE = PASS |
| 4 | Enquiries / Communications / Email Templates | owner 已宣告 CLOSED，本次未重开、未提出新功能或模板改造 |
| 5 | 任何新开发 | 四项决策均未暴露实际缺陷；本报告不创建开发 backlog |

---

## 附录 — 执行的命令

```bash
# 基线
git fetch origin main && git rev-parse origin/main HEAD && git rev-list --left-right --count origin/main...HEAD
git branch -a && git worktree list

# 文件名变体（仓库内）
find . -path ./node_modules -prune -o -iname "*CLIENT_DECISION*" -print -o -iname "*OWNER_DECISION*" -print \
     -o -iname "*DECISION_REGISTER*" -print -o -iname "*DECISION_LOG*" -print \
     -o -iname "*PHASE1_DECISION*" -print -o -iname "*RELEASE_DECISION*" -print

# 全历史路径枚举（5758 提交）
git log --all --pretty=format: --name-only | sort -u | grep -i decision
git log --all --diff-filter=A --name-only --pretty=format:"%h" | grep -iE "CLIENT_DECISIONS|DECISION_REQUIRED"

# 全历史内容 pickaxe
git log --all --oneline -S"07_CLIENT_DECISIONS_REQUIRED"
git log --all --oneline -S"CLIENT_DECISIONS"
git log --all --oneline -S"DECISIONS_REQUIRED"
git log --all --oneline -S"C-10" -- '*.md'
git log --all --oneline -S"C10" -- '*.md'        # 1 命中 = 假阳性 ORC1083

# 命中位置（仓库外）
ls /Users/jet.zhang/CopilotWorkspace/Loveable/
git rev-parse --is-inside-work-tree   # 于该目录 → fatal: not a git repository

# 落实证据
git merge-base --is-ancestor origin/lovable-sync origin/main
git log origin/main --pretty="%an" | sort | uniq -c | sort -rn
git log origin/main --pretty="%h %s" | grep -iE "agreement|warranty|onboarding"
grep -E "SUPABASE_URL|SUPABASE_PROJECT_ID" .env
sed -n '1,20p' src/lib/background.server.ts
```

**安全边界复核：** 本次调查未修改应用源码、未修改既有项目文档（本报告为新增文件）、
未改动数据库、未应用迁移、未切换 flag、未启用客户通信、未触发外部集成、
未提交/推送/合并/发布、未删除未跟踪文件、未 reset 工作区。
仓库中既有的 3 个已修改文档（上一任务产出）与 19 个未跟踪文件**均保持原样**。
