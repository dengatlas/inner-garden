# Changelog

## 1.3.0 — 账号专注记录

- 新增可选账号专注记录与统计同步，沿用手动／前台12分钟调度；需先更新现有工作区后端。
- 顶部计时器增加任务备注与专注记录入口，按今日、本周、本月查看明细及统计。
- 完成记录由后台统一落盘，暂停、恢复、账号切换和多个新标签页不会重复计数；运行中的计时保持本机。
- 本机访客历史经确认后归入账号；专注记录与日程块分别维护。

## 1.2.2 — flomo 同步修复

- 修复保存后误报待同步、单端修改误报冲突和临时认证故障导致退出账号。
- 首次加入账号后直接同步；真实差异逐条展示，其他笔记继续交换。
- 增加本机备份历史、归档预览与合并恢复，正常状态隐藏插件连接恢复入口。
- 更新插件后仍需更新小程序预览，两端真实账号验收另行记录。


## 1.2.1 — Phone authorization candidate

- Let the current Mini Program account authorize a separate desktop session through CloudBase OAuth device flow; keep credentials in the extension worker.
- Generate QR codes locally, require explicit UID confirmation, and discard canceled, expired or superseded challenges.
- Show account UID and distinguish account login from workspace/flomo synchronization; allow valid current-password changes without an unrelated recovery requirement.
- Record the separately authorized three-file Mini Program change and the reviewed, not-yet-deployed account proxy patch. Real phone authorization and two-device sync remain pending.

## 1.2.0 — Local public-edition candidate

- Independent fixed extension ID for coexistence with the old installation.
- Retain the existing CloudBase environment for its service-eligible accounts; new-origin authorization and real-account acceptance remain pending.
- Bundle DM Sans and Newsreader with OFL licenses; generate website icons locally.
- Exclude unverified built-in prompt material without removing existing notes.
- Establish canonical shared sources, extension-only build/check/tests and explicit-allowlist ZIP packaging.
- Preserve local editing, schema-v3, storage keys, drafts, account isolation and Shanghai display time.
- Provide installation, privacy, development and migration instructions. No upload or publication performed.
