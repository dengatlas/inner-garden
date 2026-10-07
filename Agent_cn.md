# Agent_cn.md — 独立 Inner Garden 扩展规则镜像

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
- 新 ID 是 ohdenlpjdfngpaaggijhcagfpafecgdn，保持稳定。用户于 2026-09-30 授权追加账号来源，配置及预检已验证。真实账号登录/同步仍待验收；不能仅凭来源授权宣称全部账号已可用。

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

- 本目录已获确认为独立 Git 根，工作分支用 codex/；当前分支为 codex/public-edition，origin 为 https://github.com/dengatlas/inner-garden.git。不继承原项目历史和 remote，不初始化其他项目。
- npm run package 按 scripts/extension-files.mjs 白名单打包，包含 LICENSE、字体/图标许可和安装/隐私说明，排除 config.local.js 与私人数据。
- 安装方式为解压、Chrome 开发者模式、加载含 manifest 的目录；不承诺任意 CRX 拖拽或 GitHub 自动更新。
- manifest、package.json、策略和 changelog 版本保持一致；最终内容变化后重建并验证包。
- 用户于 2026-09-30 授权创建公开仓库 dengatlas/inner-garden 并推送本独立项目。Release、商店提交和远程服务修改仍需单独授权。

## 2026-10-06 flomo coordination authority

The user authorized coordinated changes in this independent extension and D:/tab-out for flomo sync from the current chat. This supersedes the earlier three-file-only exception for this task; the repositories and commits remain separate, and no remote deployment/publication is included.

The canonical cross-client flomo modules are the three explicit files shared/flomo.js, shared/flomo-sync.js and shared/flomo-transport.js in D:/tab-out. Its scripts/sync-flomo-contract.mjs updates only those files in this repository and records docs/flomo-contract.json; npm run build still generates extension/shared/ locally. npm run check validates their pinned content hashes. Do not copy auth clients or prompt seeds between repositories.

Explicitly enabled account libraries follow the signed-in account and join the unified manual/12-minute foreground sync trigger. The worker persists attempt throttling and each library's pending state; one engine's failure never blocks the other. Viewing the original local library remains local; account changes never copy the previous account into the new one. Drafts/images/preferences remain local. Received-note counts and pending/conflict status must remain visible, including edits made during synchronization. No backend schema change is required.
