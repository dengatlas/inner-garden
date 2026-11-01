# Agent_cn.md — 独立 Inner Garden 扩展规则镜像

## 2026-10-26 小程序帮助整合

用户授权在本仓库与 D:/tab-out 协同完成“电脑端与 AI 连接”的文档及帮助，两个仓库分别保留修改。README 和 INSTALL 按 Windows Chrome 说明 ZIP 安装、小程序内扫码确认同 UID、首次同步、专注与 flomo 独立开关及手动更新。AI/MCP 无需安装扩展，当前不开放专注历史。安装说明修改后仅生成单独的本机候选包，保留已发布 v1.3.2 的 ZIP 与校验文件。本帮助任务不包含再次推送、替换发布附件、服务修改或小程序发布。见 D:/tab-out/docs/AGENT_MCP_HELP_DESIGN.md。

## 范围与沟通

- 使用简体中文说明结果，技术标识保持英文。
- 仅维护独立桌面 Chrome MV3 新标签页工作区：标签、专注、日历、周计划、日课与 flomo。
- 不修改原 Tab Out，不引入其 PWA、小程序、后端、个人导出或 Git 历史。
- 2026-10-01 明确例外：用户仅授权修改 D:/tab-out/miniprogram/features/account/index.wxml、features/account/index.js 和 utils/sync-service.js，增加手机当前账号授权电脑；不修改其他原项目文件，不执行原项目生成式构建，不把这些文件引入本独立仓库。
- 规则正文以 AGENTS.md 为准，两份同步维护。

## 当前依据

- docs/DECISIONS.md 和 docs/decisions/public-edition.json 记录已确认的 1B/2A/3A/4A/5A 及后续公开仓库授权：现有 CloudBase 面向服务允许的账号、新固定 ID、本地字体图标、审查 prompt 与独立 Git。
- docs/ACCEPTANCE.md 记录当前验证和待验收事项；自动检查、浏览器验收、云账号验收、发布分开报告。
- MIGRATION_HANDOFF.md、PUBLIC_RELEASE_PLAN.md、COPY_BASELINE.json 是被忽略的历史交接材料，不代表当前产品策略；不重写基线掩盖有意变化。
- 新 ID 是 ohdenlpjdfngpaaggijhcagfpafecgdn，保持稳定。用户于 2026-09-30 授权追加账号来源，配置及预检已验证。当前验收以 docs/ACCEPTANCE.md 为准，包含用户确认的实际桌面登录及部分同步成功；不能仅凭来源授权宣称全部账号已可用。

## 实现边界

- 保持离线编辑、既有存储键、schema-v3、未保存草稿、账号隔离、本地备份和上海显示时区。
- workspace-background.js 统一串行写工作区/账号并协调多页，页面不得绕过它；设备导入也经过后台协调。
- 标签、稍后再看、专注只在本机；工作区同步日历、周计划与日课。flomo 独立可选同步，图片、草稿、偏好留本机。
- 同服务迁移排除认证会话并重置设备 ID，不默默合并不同账号，只导入空白安装。
- 没有当次授权不修改远程服务、来源或账号政策。获准后追加确切来源并保留已有来源。
- Git/发行包不带本机配置、凭据、会话、私人导出或浏览器个人资料；连接 URL 和 manifest key 是公开标识。

## 开发与验证

- 根级 shared/ 为 canonical，npm run build 仅生成 extension/shared/，不执行原多端构建。
- 维护工具需要 Node 22+，用户安装不需要构建；不为安装引入框架、后端或依赖。
- 代码变更依次运行 build、check、test、git diff --check；UI 另在独立个人资料中验收解压后的真实 Chrome 扩展。
- 使用针对性检查，小型可逆文档改动不加重复测试；收尾清理不再使用的临时文件和测试个人资料。
- 字体来源哈希与许可见 docs/font-assets.json 和 extension/fonts/；prompt 审查见 docs/prompt-review.json，不把应用 MIT 当成第三方素材许可。

## 分发与 Git

- 本目录已获确认为独立 Git 根，工作分支用 codex/；1.3.2 发布准备分支为 codex/release-1.3.2，早期独立分支为 codex/public-edition，origin 为 https://github.com/dengatlas/inner-garden.git。不继承原项目历史和 remote，不初始化其他项目。
- npm run package 按 scripts/extension-files.mjs 白名单打包，包含 LICENSE、字体/图标许可和安装/隐私说明，排除 config.local.js 与私人数据。
- 安装方式为解压、Chrome 开发者模式、加载含 manifest 的目录；不承诺任意 CRX 拖拽或 GitHub 自动更新。
- manifest、package.json、策略和 changelog 版本保持一致；最终内容变化后重建并验证包。
- 用户于 2026-09-30 授权创建公开仓库 dengatlas/inner-garden 并推送本独立项目。Release、商店提交和远程服务修改仍需单独授权。

## 2026-10-06 flomo coordination authority

The user authorized coordinated changes in this independent extension and D:/tab-out for flomo sync from the current chat. This supersedes the earlier three-file-only exception for this task; the repositories and commits remain separate, and no remote deployment/publication is included.

The canonical cross-client flomo modules are the three explicit files shared/flomo.js, shared/flomo-sync.js and shared/flomo-transport.js in D:/tab-out. Its scripts/sync-flomo-contract.mjs updates only those files in this repository and records docs/flomo-contract.json; npm run build still generates extension/shared/ locally. npm run check validates their pinned content hashes. Do not copy auth clients or prompt seeds between repositories.

Explicitly enabled account libraries follow the signed-in account and join the unified manual/12-minute foreground sync trigger. The worker persists attempt throttling and each library's pending state; one engine's failure never blocks the other. Viewing the original local library remains local; account changes never copy the previous account into the new one. Drafts/images/preferences remain local. Received-note counts and pending/conflict status must remain visible, including edits made during synchronization. No backend schema change is required.

## 2026-10-14 flomo repair

flomo enabled state is independent of the viewed library. Desktop original local records are read-only archive previews; viewing them must not pause account sync or reimport them implicitly. First enable performs an immediate exchange after a single account/count preview. Conflicts are per note/tag with stale-preview guards; unresolved items do not block independent notes. Preserve immutable pending requests and local-only images/drafts.

Temporary refresh failures preserve sessions; explicit invalid grants require reauthentication while retaining the cached account library. Backups are account-scoped, retain 30 automatic entries plus manual/legacy entries, and restore by reviewed merge. Generate Mini Program copies only with D:/tab-out/scripts/build-shared.mjs --target=miniprogram; do not regenerate the legacy desktop, PWA or backend for this repair. No backend deployment is required.


## 2026-10-24 account focus records

The user authorized coordinated implementation in D:/tab-out (Mini Program, shared workspace/focus contracts and existing backend) and E:/Traecode/Inner garden (formal extension), with separate commits. Completed focus sessions now have optional account sync through the existing workspace queue, entity type focus_session, capability-gated pulls and an independent focusCursor; previous device-only focus-history statements are superseded by this section. Running timers remain local. Manual/12-minute foreground scheduling is unchanged.

Fix ownership at session start. Account caches and statistics are isolated; legacy/guest history needs an explicit count/date preview and one-time claim journal with an original backup. Only completed focus/custom/countup records count, overlap across devices sums separately, identical IDs deduplicate, dates use Shanghai completion day. The first edition adds no record edit/delete UI. Desktop completions are serialized in the worker. Day/week/month records are accessible beside the existing timer; optional notes have the same 80-character limit as mobile.

Focus history sync and calendar projection have separate opt-ins. Project only local-source sessions for the corresponding account; do not project downloaded records again or recreate deleted calendar blocks. Calendar deletion never deletes original focus history or statistics. Sync off retains caches/queues. Main-package focus-account-store.js owns Mini Program cache/claim metadata; the extension uses innerGardenFocusAccounts. See docs/FOCUS_SYNC.md for storage, migration, tests and rollout.

Canonical focus-records.js and workspace-sync.js live in D:/tab-out/shared and are copied by scripts/sync-focus-contract.mjs with pinned hashes. Port only the reviewed focus changes to sync-client.js; retain each project's authentication differences. Backend deployment adds private focus_sessions and the owner/type/revision change index before clients. Do not deploy the legacy extension, PWA or flomo backend for this feature.

User restriction: legal-domain configuration has limited saves. Any modification/save of WeChat legal domains requires explicit consent for that individual save. Preserve existing domains, gateway routes, origins and authentication settings during this rollout. Code, test, package, cloud-deploy and real-device evidence are separate states.


## 2026-10-24 flomo account-cache workflow

The current flomo workflow supersedes older editable local/account library switching. After first enable, signed-in users view and edit their current account's device cache; pausing sync keeps that cache editable. Original local records remain a read-only archive and are never copied again merely by viewing, reopening, or switching accounts. First enable exchanges immediately with no empty confirmation when there are no original notes; otherwise show one account/count merge preview. Keep images and drafts local and preserve immutable pending requests, per-item conflicts and account isolation.

Persist flomo sync choice per account and device. An explicit false overrides legacy inference from an existing account cache; reload, restart and cache reads must not re-enable it. Retain manual and 12-minute foreground scheduling. Show workspace (calendar/daily/week plans), focus and flomo results separately even though focus uses the workspace protocol. A failure in one category must not relabel or conceal another result.

Keep page/worker flomo messages compatible. Missing owner fields must not create an undefined library. Preserve anomalous historical libraries for inspection; do not silently delete, merge into the active account, or upload them. Device migration retains flomo content/caches/pending data but resets its sync choices on the target device. Existing focus-history, claim-journal, source-device and opt-in migration rules remain unchanged.

This client-only candidate requires no backend deployment, origin/gateway changes or legal-domain saves. Keep the already-deployed focus backend and its acceptance record intact. The formal extension candidate is 1.3.1; record new build, package/browser, Mini Program preview and same-UID real-account acceptance separately. See docs/FLOMO_SYNC.md in the independent extension and docs/FLOMO_DEPLOYMENT.md in D:/tab-out.


## 2026-10-25 device authorization proxy

The existing tab-out-sync authentication proxy now supports device-code issuance and exchange. The deployment preserves all current origins, routes, configuration and previously deployed workspace/focus/agent code. Device-code issuance and pending responses were verified live; phone confirmation, same-UID login and bidirectional synchronization remain separate acceptance steps. See docs/DEVICE_AUTH_SERVICE_CHANGE.md and docs/WECHAT_DESKTOP_LOGIN.md for current evidence. Mini Program account-page and binding feedback changes remain in D:/tab-out; do not copy its authentication client wholesale into this independent extension.


## 1.3.2 device-flow compatibility

Device authorization codes are opaque strings (1-256 visible non-space characters), preserved without case or whitespace normalization. QR v1 may include the exact server-issued scope. A successful device grant may omit refresh_token; accept a valid access token and expiry after exact UID verification, keep credentials in the worker, cap access-only trust at the absolute access expiry, and show that deadline. Never claim ten-day persistence for such grants. Version, manifest, package policy and changelog are 1.3.2. The packaged ZIP passed isolated Chrome UI checks; real same-UID service exchange passed with the temporary test session revoked. Installed-client UI and bidirectional data acceptance remain separate.

## 2026-10-26 release preparation and user acceptance

The user confirmed successful login in their actual installed desktop client and partial data synchronization. Record this as user-reported real-terminal acceptance. Data categories, directions and create/edit/delete coverage were not specified; do not infer full workspace/focus/flomo bidirectional acceptance. This section supersedes generic pending-login statements for this user-confirmed scope.

Prepare version 1.3.2 as a formal release on codex/release-1.3.2. Keep source, package and acceptance evidence aligned. Preserve necessary development paths and public connection identifiers. After reviewing the final artifacts and release notes, the user explicitly authorized committing this reviewed batch, pushing and integrating it into main, tagging v1.3.2 and creating the formal public GitHub Release with only the installation ZIP and its checksum attached. This authorization applies to this 1.3.2 release. No store submission or remote-service changes are included.


## 2026-11-01 workspace record history candidate

The user authorized coordinated recovery and implementation in this independent extension, D:/tab-out Mini Program/shared contracts and the existing workspace backend, with separate commits and acceptance. The desktop candidate is 1.3.3; preserve published 1.3.2 assets. This implementation does not publish clients or change origins, authentication, gateway routes or WeChat legal domains.

Calendar and daily-field cloud history is account-scoped, keeps two distinct prior contents without TTL, and restores by expected-version guarded new writes. Missing snapshots are not explicit deletions. New workspace device identities are installation-specific and excluded from migration; sent requests and focus source-device IDs remain immutable. Mobile editors patch latest workspace; restoration preserves drafts and refreshes affected editors across desktop pages without replaying old generated-summary callbacks. All record dates remain Asia/Shanghai. See docs/RECORD_HISTORY.md; service deployment and true device acceptance remain separately evidenced.

## 2026-11-01 桌面 1.3.3 发布授权

用户授权检查 dist 中现有 1.3.3 安装包、激活对应 GitHub 账号，并将检查通过的最新版本发布到 dengatlas/inner-garden。在 codex/release-1.3.3 对齐源码与安装说明，检查通过后提交并合入 main、打 v1.3.3 标签，将安装 ZIP 和 SHA-256 作为最新 GitHub Release 发布。保留 v1.3.2 附件和已有本机修改。本授权不包含小程序发布、升级个人浏览器安装或修改服务、来源、认证、网关及微信合法域名。
