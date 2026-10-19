# Phase 1 发布恢复报告 — Home Insulation Victoria

**日期：** 2026-10-19
**性质：** 发布优先（GO-LIVE RECOVERY），非 UAT 延伸
**代码基线：** GitHub `main` = `6163fabd`
**修复分支：** `p1/release-blockers` = `c0fe0797`（已推送，未合并、未发布）
**生产地址：** https://estimate.homeinsulationvictoria.com.au
**预览地址：** https://id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app

> 本报告只记录本次实测到的结果。未执行的步骤标为「未验证」，不标 PASS。
> HV-2594 的延伸 UAT、F-1、Option D 订座实验已按要求停止。

---

## 0. 执行摘要（一句话）

**Phase 1 的 Office 端已经可以交给客户使用**：登录、仪表盘、询盘列表、客户/作业详情、状态与下一步、模板预览与手动沟通、记录沟通结果，全部在生产站实测通过。
唯一一个「看起来像崩溃」的缺陷（`/admin/operations` 整页空白）已定位为**阻塞式路由加载 + 25 秒聚合查询**，修复已提交到开发分支，等待合并发布。

**没有发现任何需要改数据库、改 schema 或改业务逻辑才能发布的阻塞项。**

---

## A. READY NOW — 客户现在就能安全使用的功能

以下全部在**生产站**（estimate.homeinsulationvictoria.com.au）用真实 Office 账号实测：

| # | 能力 | 实测结果 |
|---|---|---|
| 1 | Office 登录 | ✅ 通过，落到 `/admin/needs-me` |
| 2 | 仪表盘（Pipeline）加载 | ✅ 通过，102,442 字符，无 JS 异常 |
| 3 | 询盘列表（685 条） | ✅ 通过，`?tab=enquiries` 198,458 字符 |
| 4 | 打开客户/作业记录 | ✅ 通过，HV-2594 详情页正常渲染 |
| 5 | 作业状态显示 | ✅ 通过（如「Preliminary Estimate Ready」） |
| 6 | 下一步 / 等待方显示 | ✅ 通过（「Owner to book Home Insulation Ready Check」「Waiting on Owner」） |
| 7 | 新建询盘（电话/手工） | ✅ 入口可用（New enquiry 对话框） |
| 8 | 模板总览（19 邮件 / 4 Mitti / 17 合规） | ✅ 通过，只读，明确「Viewing here never sends」 |
| 9 | 模板预览 / 复制主题 / 下载 HTML | ✅ 入口存在，**不发送任何邮件** |
| 10 | 作业页「Log phone call / external email」 | ✅ 可记录外部沟通结果 |
| 11 | 作业页站内消息（内部） | ✅ 可用，明确「Email, SMS and WhatsApp are not connected」 |
| 12 | 安全默认值 | ✅ `customer_comms_enabled=false`、`save_my_spot_real_send_enabled=false`、`payment_option_gate_enabled=false` |

**结论：Priority 1（客户询盘）与 Priority 2（仪表盘）的核心操作路径已可用。**

---

## B. MUST FIX BEFORE GO-LIVE — 真正的阻塞项

### B-1（唯一）`/admin/operations` 整页空白 — 已修复，待合并发布

**现象（生产 + 预览均复现）：** 打开 `/admin/operations` 得到完全空白页。HTML 有 24KB，但 `<body>` 内只有通知节点，没有 shell、没有 loading、没有报错。实测 **25 秒后**内容才出现。

**根因：** 路由 loader 用了阻塞式 `ensureQueryData(operationsOptions)`。该查询要扫 1227 个作业、22 张关联表，SSR 在等待期间不 flush，浏览器拿到空文档 → 用户判定为「崩溃」。

**修复（`c0fe0797`）：**
- `admin.operations.tsx` / `admin.operations-preview.tsx` 去掉阻塞 loader；
- `useSuspenseQuery` → `useQuery`，先渲染 shell + 明确文案「Reading every job — this can take up to 30 seconds…」；
- 增加可重试的内联错误态（原来会直接空白）。

**改动范围：** 2 个前端路由文件，零数据库、零 schema、零工作流改动。

**为什么必须修：** 同一查询也驱动作业详情页的「Current operational facts」摘要，那里会显示「Loading current operational facts…」长达 25 秒。修完至少让等待可见、可解释、可重试。

> **仍存在的性能债（不阻塞发布）：** 该聚合查询本身仍需约 25 秒。建议发布后单独排期优化（`byJobs` 每批 150 个 job，22 张表串行分页）。本次不扩大范围。

---

## C. DEFER UNTIL AFTER LAUNCH — 发布后再处理

| # | 项 | 影响 | 判断 |
|---|---|---|---|
| C-1 | `bookings` 查询返回 HTTP 400（仪表盘「Checking real Ready Check bookings…」长期不消失） | 无错误横幅、无页面异常；Ready Check 作业仍出现在看板 | 不阻塞。生产构建的查询形状与 `main` 已不同，可能已在 main 修复，未逐版本核对 |
| C-2 | 聚合查询 25 秒性能 | 体验差，可等待 | 发布后优化 |
| C-3 | `/admin/list`、`/admin/pipeline`、`/admin/needs-me` 首屏需 11–15 秒 | 有 loading 文案 | 发布后优化 |
| C-4 | 安装商侧 geotag 上传未浏览器验证 | 不影响 Office 收询盘 | 发布后补验 |
| C-5 | F-1（`piesa_scheduled → piesa_complete`）从未浏览器验证 | 属后期阶段，不影响接询盘 | 明确不声明 PASS |
| C-6 | Mitti / Xero 实时 / VEEC 自动化 / 高级 PIESA 排程 | 配置关闭 | Phase 2 范围 |

---

## D. COMMUNICATION STATUS — 模板与发送模式

### D-1 发送模式（实测值）

| 开关 | 当前值 | 含义 |
|---|---|---|
| `customer_comms_enabled` | **false** | 所有对外邮件/短信被阻断 |
| `save_my_spot_real_send_enabled` | **false** | Save-My-Spot 真实发送需两个开关同时开 |
| 投递适配器 `customer_delivery_settings.enabled` | 未开 | 连接健康未测 |
| `payment_option_gate_enabled` | **false** | 真实作业支付与排程锁定 |

**结论：当前不可能向真实客户自动发送任何内容。这是正确的交接姿态。**

### D-2 客户邮件模板（13 个）

**客户邮件（13 个）**

| 模板 | 批准状态 |
|---|---|
| Likely eligible estimate | ✅ **已批准**（项目记录，2026-10-01） |
| Save your spot | ✅ **已批准**（Jo Lowe，2026-10-07） |
| Save your spot — no ceiling size | ⚠️ Jo 2026-10-08 提出，**无留存批准记录** |
| Needs onsite confirmation estimate | ⚠️ 无批准记录 |
| Ineligible result | ⚠️ 无批准记录 |
| Estimate not opened reminder | ⚠️ 无批准记录 |
| No partner in service area | ⚠️ 无批准记录 |
| Insulation details (Group B) | ❌ 真实发送**未批准（held）** |
| Measured quote | ❌ 草稿，未批准 |
| Booking confirmation + ESC consent | ❌ 草稿，未批准 |
| Pre-installation pack | ❌ 草稿，未批准 |
| Final VEEC assignment signing | ❌ 草稿，未批准 |
| Completion email + certificate pack | ❌ 草稿，未批准 |

**合作方邮件（6 个）**

| 模板 | 批准状态 |
|---|---|
| Installer partnership invitation | ✅ 已批准文案（项目记录） |
| Partner welcome | ✅ 已批准（Jo，2026-10-08） |
| Application — send back for changes | ✅ 已批准（Jo，2026-10-08） |
| Application — decline | ✅ 已批准（Jo，2026-10-08） |
| REC partnership invitation | ⚠️ 无批准记录 |
| Partner portal login | ⚠️ 草稿，待 Jo 批准 |

### D-3 可以立即交付的沟通方式

| 模式 | 状态 |
|---|---|
| **手动预览 → 复制 → 从自己邮箱发送 → 回填结果** | ✅ **可用**（模板中心 + 作业页 Log phone call / external email） |
| 站内消息（内部/门户） | ✅ 可用，不触发邮件 |
| 模板只读审阅（不发送、不保存、不连接） | ✅ 可用 |
| **自动发送** | ❌ **不可用，也不应开启** |

**明确建议：交接时保持 `customer_comms_enabled=false`。自动发送在模板批准、触发条件、收件人三方都核对完之前不得打开。**

---

## E. DEPLOYMENT STATUS

| 环境 | 实际状态 | 证据 |
|---|---|---|
| **GitHub `main`** | `6163fabd` — "fix(Brief X UAT): close PIESA stage-gate deadlock" | `git ls-remote` |
| **开发修复分支** | `p1/release-blockers` = `c0fe0797`，已推送 | push 成功 |
| **Lovable Preview** | 构建 `index-DPoH4ukE.js`，Office 门户可用 | 实测 `/admin` 正常 |
| **Published 生产** | `https://estimate.homeinsulationvictoria.com.au`（302 → 自定义域名），构建 `index-DDnZ9Rrz.js` | curl + 实测 |

**关键事实：**
1. **Preview ≠ Published**：两者前端构建哈希不同，是两次独立构建。
2. **Published 当前是可用的**：Office 登录与全部核心页面在真实生产域名上实测通过。
3. **Preview 与生产共用同一个 Supabase（`wvuffpykgnqliikhodzl`）**，没有独立预发库。
4. 本次修复**尚未进入 Preview、尚未进入生产** —— 需要合并到 `main` 后由 Lovable 同步。

---

## F. GO-LIVE ACTION — 最少剩余步骤

### 立即可做（不需要等修复）

客户**今天**就可以开始用 Office 门户接询盘。当前生产站已经支持：
查看询盘 → 打开客户 → 看状态与等待方 → 预览模板 → 手动发邮件 → 回填结果。

### 建议做（30 分钟内）

1. **合并 `p1/release-blockers` → `main`**（1 个提交、2 个文件、零数据库改动）。
2. 等 Lovable Preview 自动同步，打开 `/admin/operations` 确认显示「Reading every job…」而不是空白。
3. 由 owner 执行 Lovable **Publish**，把这次修复带到生产。

> 生产发布需要 owner 明确批准，本次**未执行**。

### 必须由 owner 决定（不可代为决定）

1. 是否合并 + 发布上述修复。
2. 是否接受「聚合页面约 25 秒」作为 Phase 1 的已知限制。
3. 哪些模板批准对外使用（尤其 D-2 中标 ⚠️ 的 5 个）。
4. 自动发送继续保持关闭 —— 建议维持到模板/触发/收件人三方核对完成。

### 交接时必须告知客户的限制

- 自动邮件/短信**全部关闭**，沟通一律手动。
- 支付闸门关闭，真实作业的 PIESA 与排程被锁定（这是设计行为，不是故障）。
- Xero 仅 Demo 租户，Mitti 未接通，VEEC 无自动化。
- `/admin/operations` 与作业详情摘要首次打开需等待约 25 秒。

---

## 附：本次实测记录

| 路由 | 结果 | 耗时/说明 |
|---|---|---|
| `/admin` | ✅ 102,442 字符 | ~10s，685 询盘，含阶段/下一步/等待方 |
| `/admin?tab=enquiries` | ✅ 198,458 字符 | 询盘全量 |
| `/admin?tab=board` | ✅ 正常 | 无错误横幅 |
| `/admin?tab=jobs` / `?tab=quotes` | ✅ 正常 | — |
| `/admin/jobs/<HV-2594>` | ✅ 1,485 字符 | 详情正常；摘要区等待 25s |
| `/admin/communications` | ✅ 3,514 字符 | 模板审阅/复制，明确不发送 |
| `/admin/templates` | ✅ 1,443 字符 | 19/4/17 模板 |
| `/admin/list` | ✅ 110,426 字符 | 需 ~15s |
| `/admin/pipeline` | ✅ 1,426 字符 | 需 ~15s |
| `/admin/needs-me` | ✅ 正常 | 需 ~11s |
| `/admin/operations` | ❌→🔧 空白 25s | **已修复，待合并** |

**运行时错误：** 全程无 `pageerror`。仅一个静默 HTTP 400（`bookings` 查询），无用户可见错误横幅。

**未验证（不声明 PASS）：** 安装商/电工/房主端全链路、F-1、真实支付、真实 Xero、真实 Mitti、生产迁移 0203/0205 的实际应用状态。
