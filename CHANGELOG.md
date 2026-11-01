# Changelog

## 1.3.3 — 记录历史与恢复

- 日程与日课逐条保留最近两个不同旧内容，支持当天变更、移日期与删除查找、差异比较及带当前版本校验的恢复。
- 明确删除与独立设备身份保护跨端新增和不可变重试；恢复时保留本机草稿，并刷新相关编辑器。
- 更新安装、扫码登录及同步说明。历史服务已单独上线；桌面安装、小程序发布和三端真实操作分别验收，见 docs/RECORD_HISTORY.md。
- 保留已发布的 1.3.2 安装包及校验文件；GitHub 下载版需手动覆盖原目录并重新加载。

## 1.3.2 — 手机授权登录兼容修复

- 用户已确认真实桌面登录及部分数据同步成功；详细数据类别、方向和操作覆盖尚未逐项确认，见验收记录。

- 授权码按原始字符串传递，兼容混合大小写、下划线和其他可见字符。
- 二维码携带服务端签发的授权范围，手机确认按该范围提交。
- 接受服务端签发的无刷新凭据会话，并按真实有效期保存和提示；到期重新登录。
- 授权等待、过期、账号资料读取失败提供明确反馈，保留用户核对 UID 后才登录。
- 保留现有账号、工作区和同步数据；本地安装包不代表真实跨端同步已验收。

## 1.3.1 — flomo 账号缓存与同步操作候选

- 首次开启后统一查看和编辑当前账号在本机的笔记缓存；开启同步后双向交换，暂停同步仍可离线编辑。
- 首次合并仅在有原本机笔记时确认，空库直接同步；原本机记录作为只读归档保留，不反复加入账号。
- flomo 开关按账号、设备持久保存，明确关闭优先于旧账号缓存；手动／前台12分钟调度不变。
- 日程、专注记录、笔记分别显示同步结果；修正页面与后台消息协议兼容，异常历史库保留供核查。
- 设备迁移保留笔记与队列，在新设备重新开启 flomo 同步；专注记录既有迁移规则不变。
- 本轮无需后端部署；本地检查、安装包及真实账号跨端验收状态见 docs/ACCEPTANCE.md。

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
